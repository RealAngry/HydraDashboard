const express = require("express");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const axios = require("axios");
const randomstring = require("randomstring");
const router = express.Router();

const { db } = require("../function/db");
const { logError } = require("../function/logError");

const hydrapanel = {
    url: process.env.PANEL_URL?.endsWith("/")
        ? process.env.PANEL_URL.slice(0, -1)
        : process.env.PANEL_URL,
    key: process.env.PANEL_KEY,
};

// Validate required environment variables
const requiredEnvVars = [
    "PANEL_URL",
    "PANEL_KEY",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_CALLBACK_URL",
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
    }
}

// Configure passport to use Discord
passport.use(
    new DiscordStrategy(
        {
            clientID: process.env.DISCORD_CLIENT_ID,
            clientSecret: process.env.DISCORD_CLIENT_SECRET,
            callbackURL: process.env.DISCORD_CALLBACK_URL,
            scope: ["identify", "email"],
            passReqToCallback: false,
        },
        (accessToken, refreshToken, profile, done) => {
            if (!profile?.id || !profile?.username || !profile?.email) {
                return done(new Error("Incomplete profile data from Discord"));
            }
            return done(null, profile);
        },
    ),
);

// Serialize and deserialize user
passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

/**
 * Checks if an account exists in HydraPanel and creates one if it doesn't
 * @param {string} email - User's email
 * @param {string} username - User's username
 * @param {string} id - User's Discord ID
 * @returns {Promise<void>}
 */
async function checkAccount(email, username, id) {
    if (!email || !username || !id) {
        throw new Error("Missing required parameters for account check");
    }

    try {
        console.log(`Checking account for user: ${email} (ID: ${id})`);
        
        // First, check if we already have a verified user ID in the database
        const existingUserId = await db.get(`id-${email}`);
        if (existingUserId) {
            console.log(`User ${email} already has cached ID: ${existingUserId}`);
            
            // Do a quick verification to make sure the cached ID is still valid
            try {
                const verifyResponse = await axios.post(
                    `${hydrapanel.url}/api/getUser`,
                    {
                        type: "id",
                        value: existingUserId,
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                            "x-api-key": hydrapanel.key,
                        },
                        timeout: 10000,
                    }
                );
                
                // If valid, just return
                if (verifyResponse.data?.userId) {
                    return;
                }
                
                // If verification fails, continue to create a new user
                console.log(`Stored ID ${existingUserId} could not be verified. Proceeding to create new account.`);
            } catch (err) {
                // If verification check fails, continue with creation
                console.log(`Failed to verify existing user ID: ${err.message}. Proceeding to create new account.`);
            }
        }
        
        // Try to create the user directly with one atomic operation
        try {
            // Create a post to a separate endpoint that handles all error cases
            // This is a direct call to the panel API
            const directApiCall = await axios.post(
                `${hydrapanel.url}/api/auth/create-user`,
                {
                    username: username,
                    email: email,
                    password: randomstring.generate({
                        length: parseInt(process.env.PASSWORD_LENGTH) || 16,
                        charset: "alphanumeric",
                    }),
                    userId: id,
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key": hydrapanel.key,
                    },
                    timeout: 15000,
                }
            );
            
            // If we get here, the creation was successful one way or another
            // Check if a valid user ID was returned
            if (directApiCall.data && directApiCall.data.userId) {
                console.log(`User ${email} created successfully with ID: ${directApiCall.data.userId}`);
                
                // Store the password and ID
                await Promise.all([
                    db.set(`password-${email}`, directApiCall.data.password || "DefaultPassword123"),
                    db.set(`id-${email}`, directApiCall.data.userId),
                ]);
                return;
            } else {
                // No user ID returned, use Discord ID as fallback
                console.log(`User creation succeeded but no user ID returned. Using Discord ID ${id} as fallback.`);
                await Promise.all([
                    db.set(`password-${email}`, directApiCall.data.password || "DefaultPassword123"),
                    db.set(`id-${email}`, id),
                ]);
                return;
            }
        } catch (error) {
            // Creation might have failed due to user already existing
            if (error.response && error.response.status === 409) {
                console.log(`User ${email} already exists in HydraPanel. Trying to retrieve ID...`);
                
                // Try to get the user ID for an existing user
                try {
                    const existingUserResponse = await axios.post(
                        `${hydrapanel.url}/api/getUser`,
                        {
                            type: "email",
                            value: email,
                        },
                        {
                            headers: {
                                "Content-Type": "application/json",
                                "x-api-key": hydrapanel.key,
                            },
                            timeout: 10000,
                        }
                    );
                    
                    if (existingUserResponse.data && existingUserResponse.data.userId) {
                        console.log(`Retrieved existing user ID: ${existingUserResponse.data.userId}`);
                        await db.set(`id-${email}`, existingUserResponse.data.userId);
                        return;
                    }
                } catch (getUserError) {
                    console.warn(`Failed to get existing user data: ${getUserError.message}`);
                }
            }
            
            console.log(`All user creation attempts failed. Using Discord ID ${id} as fallback.`);
            
            // If all attempts fail, use Discord ID as a fallback
            const password = randomstring.generate({
                length: parseInt(process.env.PASSWORD_LENGTH) || 16,
                charset: "alphanumeric",
            });
            
            await Promise.all([
                db.set(`password-${email}`, password),
                db.set(`id-${email}`, id),
            ]);
        }
    } catch (error) {
        // Log the error but don't throw it to prevent login failures
        console.error("Error during account check:", error);
        logError("Error during account check", error);
        
        // Ensure the Discord ID is stored even in case of errors
        await db.set(`id-${email}`, id);
    }
}

// Discord login route
router.get("/login/discord", (req, res, next) => {
    // Store returnTo URL from query parameter if provided
    if (req.query.returnTo) {
        req.session.returnTo = req.query.returnTo;
    }
    passport.authenticate("discord")(req, res, next);
});

// Discord callback route
router.get("/callback/discord", (req, res, next) => {
    passport.authenticate("discord", {
        failureRedirect: "/login",
        failWithError: true,
    })(req, res, (err) => {
        if (err) {
            logError("Discord authentication failed", err);
            return res.redirect("/login?error=auth_failed");
        }

        if (!req.user) {
            logError("No user object after authentication");
            return res.redirect("/login?error=no_user");
        }

        checkAccount(req.user.email, req.user.username, req.user.id)
            .then(() => {
                const redirectUrl = req.session.returnTo || "/dashboard";
                delete req.session.returnTo; // Clean up
                res.redirect(redirectUrl);
            })
            .catch((error) => {
                logError("Error during account check", error);
                res.redirect("/dashboard?error=account_check_failed");
            });
    });
});

router.get("/auth/login", async (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
        if (err) {
            return next(err);
        }
        if (!user) {
            if (info.userNotVerified) {
                return res.redirect("/login?err=UserNotVerified");
            }
            return res.redirect("/login?err=InvalidCredentials&state=failed");
        }
        req.logIn(user, async (err) => {
            if (err) {
                return next(err);
            }

            const users = await db.get("users");
            const dbUser = users.find((u) => u.username === user.username);

            if (dbUser && dbUser.twoFAEnabled) {
                req.session.tempUser = user;
                req.user = null;
                return res.redirect("/2fa");
            } else {
                return res.redirect("/dashboard");
            }
        });
    })(req, res, next);
});

router.post(
    "/auth/login",
    passport.authenticate("local", {
        failureRedirect: "/login?err=InvalidCredentials&state=failed",
    }),
    async (req, res, next) => {
        try {
            if (req.user) {
                const users = await db.get("users");
                const user = users.find(
                    (u) => u.username === req.user.username,
                );

                if (user && user.verified) {
                    return res.redirect("/dashboard");
                }

                if (user && user.twoFAEnabled) {
                    req.session.tempUser = req.user;
                    req.logout((err) => {
                        if (err) {
                            return next(err);
                        }
                        return res.redirect("/2fa");
                    });
                } else {
                    return res.redirect("/dashboard");
                }
            } else {
                return res.redirect(
                    "/login?err=InvalidCredentials&state=failed",
                );
            }
        } catch (error) {
            console.error("Error during login:", error);
            return res.status(500).send("Internal Server Error");
        }
    },
);

// Logout route
router.get("/logout", (req, res) => {
    const returnTo = req.query.returnTo || "/";
    req.logout((err) => {
        if (err) {
            logError("Logout failed", err);
        }
        req.session.destroy(() => {
            res.redirect(returnTo);
        });
    });
});

module.exports = { 
    router,
    checkAccount
};
