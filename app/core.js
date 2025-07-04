const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const { db } = require("../function/db.js");
const { ensureAuthenticated } = require("../function/ensureAuthenticated.js");
const { checkPassword } = require("../function/checkPassword.js");
const { calculateResource } = require("../function/calculateResource.js");

const router = express.Router();

const hydrapanel = {
    url: process.env.PANEL_URL,
    key: process.env.PANEL_KEY,
};

// Load plans
let plans = {};
try {
    const data = fs.readFileSync("./storage/plans.json", "utf8");
    plans = JSON.parse(data).PLAN;
} catch (err) {
    console.error("Failed to load plans:", err);
    process.exit(1);
}

// Resources
async function getUserPlan(email) {
    let plan = await db.get(`plan-${email}`);
    if (!plan) {
        plan = `${process.env.DEFAULT_PLAN}`; // Default plan
        await db.set(`plan-${email}`, plan);
    }
    return plan.toUpperCase();
}

// Existing resources (the ones in use on servers)
const existingResources = async (userID) => {
    return {
        cpu: await calculateResource(userID, "Cpu"),
        ram: await calculateResource(userID, "Memory"),
        disk: await calculateResource(userID, "Disk"), // D
    };
};

// Max resources (the ones the user has purchased or been given)
const maxResources = async (email) => {
    return {
        cpu: await db.get(`cpu-${email}`),
        ram: await db.get(`ram-${email}`),
        disk: await db.get(`disk-${email}`),
        server: await db.get(`server-${email}`),
    };
};

// Set default resources
async function ensureResourcesExist(email) {
    const planKey = await getUserPlan(email);
    const plan = plans[planKey].resources;
    const resources = await maxResources(email);

    if (!resources.cpu || resources.cpu == 0) {
        await db.set(`cpu-${email}`, plan.cpu);
    }

    if (!resources.ram || resources.ram == 0) {
        await db.set(`ram-${email}`, plan.ram);
    }

    if (!resources.disk || resources.disk == 0) {
        await db.set(`disk-${email}`, plan.disk);
    }

    if (!resources.server || resources.server == 0) {
        await db.set(`server-${email}`, plan.server);
    }

    // Might as well add the coins too instead of having 2 separate functions
    if (!(await db.get(`coins-${email}` || 0))) {
        await db.set(`coins-${email}`, 0.0);
    }
}

// Pages / Routes
router.get("/", (req, res) => {
    res.render("index", {
        req: req, // Requests (queries)
        name: process.env.APP_NAME, // Dashboard name
        user: req.user, // User info (if logged in)
    });
});

router.get("/privacypolicy", (req, res) => {
    res.render("privacypolicy", {
        req: req, // Requests (queries)
        name: process.env.APP_NAME, // Dashboard name
        user: req.user, // User info (if logged in)
    });
});

router.get("/invite", (req, res) => {
    res.render("invite", {
        req: req, // Requests (queries)
        name: process.env.APP_NAME, // Dashboard name
        user: req.user, // User info (if logged in)
    });
});

router.get("/linkvertise", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    res.render("linkvertise", {
        coins: await db.get(`coins-${req.user.email}`), // User's coins
        req: req, // Request (queries)
        name: process.env.APP_NAME, // Dashboard name
        user: req.user, // User info
        admin: await db.get(`admin-${req.user.email}`), // Admin status
        password: await checkPassword(req.user.email), // Account password
    });
});

// Dashboard
router.get("/dashboard", ensureAuthenticated, async (req, res) => {
    try {
        if (!req.user || !req.user.email || !req.user.id)
            return res.redirect("/login/discord");
        console.log("init dash");
        
        // Initialize servers as empty array
        let servers = [];
        
        // Ensure user exists in the panel
        try {
            // Check if user has a valid ID in our database
            const userId = await db.get(`id-${req.user.email}`);
            
            if (!userId) {
                // If no user ID, create one first
                console.log(`No user ID found for ${req.user.email}. Creating user in panel...`);
                await checkAccount(req.user.email, req.user.username, req.user.id);
            } else {
                // Verify the user ID is valid in the panel
                try {
                    await axios.post(
                        `${hydrapanel.url}/api/getUser`,
                        {
                            type: "id",
                            value: userId,
                        },
                        {
                            headers: {
                                "Content-Type": "application/json",
                                "x-api-key": hydrapanel.key,
                            },
                            timeout: 10000,
                        }
                    );
                } catch (verifyErr) {
                    // If verification fails, recreate the user
                    console.log(`User ID ${userId} not valid in panel. Recreating user...`);
                    await checkAccount(req.user.email, req.user.username, req.user.id);
                }
            }
            
            // Now that user is verified, fetch servers
            try {
                const response = await axios.post(
                    `${hydrapanel.url}/api/getUserInstance`,
                    {
                        userId: await db.get(`id-${req.user.email}`), // Get latest user ID
                    },
                    {
                        headers: {
                            "x-api-key": hydrapanel.key,
                            "Accept": "application/json" // Specify we want JSON
                        },
                        timeout: 15000, // Increased timeout
                        validateStatus: function (status) {
                            return status < 500; // Accept any status that's not a server error
                        }
                    },
                );

                // Check if response is HTML instead of JSON
                const contentType = response.headers['content-type'] || '';
                if (contentType.includes('text/html')) {
                    console.error(`ERROR: HydraPanel is returning HTML instead of JSON.`);
                    console.error(`This suggests the panel may be down, the URL is incorrect, or authentication has failed.`);
                    console.error(`Panel URL: ${hydrapanel.url}`);
                    console.error(`Status Code: ${response.status}`);
                    console.error(`First 100 chars of response: ${response.data.toString().substring(0, 100)}...`);
                    
                    // Render with empty servers
                    servers = [];
                } else {
                    // Safely parse and validate server data
                    if (response.data) {
                        if (Array.isArray(response.data)) {
                            // If it's already an array, use it but validate each item
                            servers = response.data.filter(server => 
                                server && 
                                typeof server === 'object' && 
                                server.Id && 
                                server.Name
                            );
                        } else if (typeof response.data === 'string') {
                            // Try to parse JSON string
                            try {
                                const parsed = JSON.parse(response.data);
                                if (Array.isArray(parsed)) {
                                    servers = parsed.filter(server => 
                                        server && 
                                        typeof server === 'object' && 
                                        server.Id && 
                                        server.Name
                                    );
                                }
                            } catch (parseError) {
                                console.warn("Failed to parse server data:", parseError.message);
                                if (response.data.includes('<!doctype') || response.data.includes('<html')) {
                                    console.error("Received HTML instead of JSON - panel may be redirecting to login page");
                                    console.error(`First 100 chars: ${response.data.substring(0, 100)}...`);
                                }
                            }
                        }
                    }
                }
            } catch (responseErr) {
                console.error("Error fetching server data:", responseErr.message);
                servers = []; // Empty array on error
            }
            
            // Ensure we have a valid array even if parsing fails
            if (!Array.isArray(servers)) {
                servers = [];
            }
            
            console.log(`Loaded ${servers.length} verified servers for user ${req.user.id}`);
            console.log("finsh servers calc");

            // Ensure all resources are set to 0 if they don't exist
            await ensureResourcesExist(req.user.email);
            console.log("finsh ensureResourcesExist calc");

            // Calculate existing and maximum resources
            const existing = await existingResources(req.user.id);
            const max = await maxResources(req.user.email);

            res.render("dashboard", {
                coins: await db.get(`coins-${req.user.email}`), // User's coins
                req: req, // Request (queries)
                name: process.env.APP_NAME || "Draco", // Dashboard name
                user: req.user, // User info
                servers, // Verified servers the user owns
                existing, // Existing resources
                max, // Max resources,
                admin: (await db.get(`admin-${req.user.email}`)) || false, // Admin status
            });
        } catch (err) {
            console.error("Error fetching server data:", err.message);
            
            // Render dashboard with empty servers array
            const existing = { cpu: 0, ram: 0, disk: 0 };
            const max = await maxResources(req.user.email);
            
            res.render("dashboard", {
                coins: await db.get(`coins-${req.user.email}`),
                req: req,
                name: process.env.APP_NAME || "Draco",
                user: req.user,
                servers: [], // Empty array when error occurs
                existing,
                max,
                admin: (await db.get(`admin-${req.user.email}`)) || false,
            });
        }
    } catch (err) {
        console.error("Unexpected error in dashboard route:", err);
        res.redirect("/?err=INTERNALERROR");
    }
});

// Credentials
router.get("/credentials", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    res.render("credentials", {
        coins: await db.get(`coins-${req.user.email}`), // User's coins
        req: req, // Request (queries)
        name: process.env.APP_NAME, // Dashboard name
        user: req.user, // User info
        admin: await db.get(`admin-${req.user.email}`), // Admin status
        password: await checkPassword(req.user.email), // Account password
        name: (await db.get("name")) || "Draco",
        logo: (await db.get("logo")) || false,
    });
});

router.get("/news", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    res.render("announcment", {
        coins: await db.get(`coins-${req.user.email}`), // User's coins
        req: req, // Request (queries)
        name: process.env.APP_NAME, // Dashboard name
        discordserver: process.env.DISCORD_SERVER,
        theme: require("../storage/theme.json"), // Theme data
        announcements: require("../storage/announcement.json"),
        user: req.user, // User info
        admin: await db.get(`admin-${req.user.email}`), // Admin status
        password: await checkPassword(req.user.email), // Account password
    });
});

router.get("/invite", ensureAuthenticated, async (req, res) => {
    res.render("invite", {
        name: process.env.APP_NAME, // Dashboard name
    });
});

router.get("/privacypolicy", ensureAuthenticated, async (req, res) => {
    res.render("privacypolicy", {
        name: process.env.APP_NAME, // Dashboard name
    });
});

router.get("/terms", ensureAuthenticated, async (req, res) => {
    res.render("terms", {
        name: process.env.APP_NAME, // Dashboard name
    });
});

router.get("/profile", ensureAuthenticated, async (req, res) => {
    try {
        // Validate user session
        if (!req.user?.email || !req.user?.id) {
            console.error("Profile access attempt without valid user session");
            return res.redirect("/login/discord");
        }

        // Log the profile access for debugging
        console.log(`Profile access by ${req.user.email} (${req.user.id})`);

        // Get user data
        let servers = [];
        try {
            const response = await axios.post(
                `${hydrapanel.url}/api/getUserInstance`,
                {
                    userId: req.user.id,
                    discordserver: process.env.DISCORD_SERVER,
                },
                {
                    headers: {
                        "x-api-key": hydrapanel.key,
                    },
                    timeout: 15000, // Increased timeout
                },
            );

            // Safely parse and validate server data
            if (response.data) {
                if (Array.isArray(response.data)) {
                    // If it's already an array, use it but validate each item
                    servers = response.data.filter(server => 
                        server && 
                        typeof server === 'object' && 
                        server.Id && 
                        server.Name
                    );
                } else if (typeof response.data === 'string') {
                    // Try to parse JSON string
                    try {
                        const parsed = JSON.parse(response.data);
                        if (Array.isArray(parsed)) {
                            servers = parsed.filter(server => 
                                server && 
                                typeof server === 'object' && 
                                server.Id && 
                                server.Name
                            );
                        }
                    } catch (parseError) {
                        console.warn("Failed to parse server data:", parseError.message);
                    }
                }
            }
            
            // Ensure we have a valid array even if parsing fails
            if (!Array.isArray(servers)) {
                servers = [];
            }
            
            console.log(`Loaded ${servers.length} verified servers for profile of user ${req.user.id}`);
        } catch (apiError) {
            console.error("Error fetching user instances:", apiError.message);
            // Continue with empty servers array
        }

        // Ensure resources exist
        try {
            await ensureResourcesExist(req.user.email);
        } catch (resourceError) {
            console.error("Error ensuring resources:", resourceError.message);
            // Continue rendering profile even if resource initialization fails
        }

        // Get user resources
        let existing, max;
        try {
            existing = await existingResources(req.user.id);
            max = await maxResources(req.user.email);
        } catch (resourceError) {
            console.error("Error fetching resources:", resourceError.message);
            // Set default values if resource fetch fails
            existing = { cpu: 0, ram: 0, disk: 0, servers: 0 };
            max = { cpu: 0, ram: 0, disk: 0, servers: 0 };
        }

        // Get coins and admin status
        let coins, admin;
        try {
            coins = (await db.get(`coins-${req.user.email}`)) || 0;
            admin = (await db.get(`admin-${req.user.email}`)) || false;
        } catch (dbError) {
            console.error("Database error:", dbError.message);
            coins = 0;
            admin = false;
        }

        // Render profile page
        res.render("profile", {
            coins: coins,
            req: req,
            name: process.env.APP_NAME || "Draco",
            discordserver: process.env.DISCORD_SERVER,
            user: req.user,
            servers: servers,
            existing: existing,
            max: max,
            admin: admin,
        });
    } catch (err) {
        console.error("Unexpected error in profile route:", err);
        res.redirect(`/?err=INTERNALERROR&t=${Date.now()}`);
    }
});

// Panel
router.get("/panel", (req, res) => {
    res.redirect(`${hydrapanel.url}/login`);
});
// Panel DISCORD INVITE
router.get("/help", (req, res) => {
    res.redirect(process.env.DISCORD_SERVER);
});

// Add diagnostics route for API testing
router.get('/diagnostics', ensureAuthenticated, async (req, res) => {
    // Check if user is admin
    const isAdmin = await db.get(`admin-${req.user.email}`);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Admin access required'
        });
    }

    const diagnosticResults = {
        success: true,
        panelConnection: false,
        panelUrl: hydrapanel.url,
        issues: [],
        recommendations: []
    };

    // Test panel connection
    try {
        // Make sure URL is properly formatted
        if (!hydrapanel.url || !hydrapanel.url.startsWith('http')) {
            diagnosticResults.issues.push('Panel URL is missing or invalid format');
            diagnosticResults.recommendations.push('Update panel URL to include http:// or https://');
        } else if (!hydrapanel.key) {
            diagnosticResults.issues.push('Panel API key is missing');
            diagnosticResults.recommendations.push('Add a valid API key in environment variables');
        } else {
            // Test connection with timeout
            const response = await axios.get(`${hydrapanel.url}/api/client`, {
                headers: {
                    'Authorization': `Bearer ${hydrapanel.key}`,
                    'Accept': 'application/json'
                },
                timeout: 5000 // 5 second timeout
            });

            if (response.status === 200) {
                diagnosticResults.panelConnection = true;
                
                // Check response type
                const contentType = response.headers['content-type'];
                if (!contentType || !contentType.includes('application/json')) {
                    diagnosticResults.issues.push(`Server returned non-JSON content (${contentType})`);
                    diagnosticResults.recommendations.push('Check panel URL and API credentials');
                }
            } else {
                diagnosticResults.issues.push(`Panel responded with status: ${response.status}`);
                diagnosticResults.recommendations.push('Check panel URL and API credentials');
            }
        }
    } catch (error) {
        diagnosticResults.issues.push(`Connection error: ${error.message}`);
        
        // HTML response detection
        if (error.response && error.response.data && typeof error.response.data === 'string' && 
            error.response.data.includes('<!DOCTYPE html>')) {
            diagnosticResults.issues.push('Panel returned HTML instead of JSON - likely an error page');
            diagnosticResults.recommendations.push('Verify panel URL points to API endpoint, not login page');
        }
        
        // Timeout error detection
        if (error.code === 'ECONNABORTED') {
            diagnosticResults.recommendations.push('Panel connection timed out - check if panel is online');
        } else if (error.code === 'ENOTFOUND') {
            diagnosticResults.recommendations.push('Domain not found - check panel URL spelling');
        } else {
            diagnosticResults.recommendations.push('Check panel URL, API key and network connectivity');
        }
    }

    // Add diagnostic info about user verification process
    const testUserId = req.user.id || req.user.discordId;
    if (testUserId) {
        try {
            const userData = await axios.get(`${hydrapanel.url}/api/client/account`, {
                headers: {
                    'Authorization': `Bearer ${hydrapanel.key}`,
                    'Accept': 'application/json'
                },
                timeout: 5000
            });
            
            diagnosticResults.userAuthTest = {
                success: true,
                message: 'Successfully retrieved user account information'
            };
        } catch (error) {
            diagnosticResults.userAuthTest = {
                success: false,
                message: `Failed to get user account: ${error.message}`
            };
            diagnosticResults.recommendations.push('Check if API key has proper permissions');
        }
    }

    res.json(diagnosticResults);
});

// Add panel config update route
router.post('/update-panel-config', ensureAuthenticated, async (req, res) => {
    // Check if user is admin
    const isAdmin = await db.get(`admin-${req.user.email}`);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Admin access required'
        });
    }

    const { panelUrl, apiKey } = req.body;
    
    if (!panelUrl || !apiKey) {
        return res.status(400).json({
            success: false,
            message: 'Panel URL and API Key are required'
        });
    }

    try {
        // Update environment variables
        process.env.PANEL_URL = panelUrl;
        process.env.PANEL_KEY = apiKey;
        
        // Update hydrapanel object
        hydrapanel.url = panelUrl;
        hydrapanel.key = apiKey;
        
        // Try test connection
        await axios.get(`${panelUrl}/api/client`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            },
            timeout: 5000
        });
        
        res.json({
            success: true,
            message: 'Panel configuration updated successfully'
        });
    } catch (error) {
        res.json({
            success: false,
            message: `Failed to connect with new settings: ${error.message}`,
            error: error.message
        });
    }
});

// Add admin panel page
router.get("/admin-panel", ensureAuthenticated, async (req, res) => {
    // Only allow admins to access this page
    const isAdmin = await db.get(`admin-${req.user.email}`);
    if (!isAdmin) {
        return res.redirect("/dashboard?error=access_denied");
    }
    
    res.render("admin-panel", {
        coins: await db.get(`coins-${req.user.email}`),
        req: req,
        name: process.env.APP_NAME || "Draco",
        user: req.user,
        admin: true,
        panelUrl: hydrapanel.url,
        panelKey: hydrapanel.key.substring(0, 5) + "..." + hydrapanel.key.substring(hydrapanel.key.length - 5)
    });
});

// Add user diagnostics route
router.get('/user-diagnostics/:userId', ensureAuthenticated, async (req, res) => {
    // Check if user is admin
    const isAdmin = await db.get(`admin-${req.user.email}`);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Admin access required'
        });
    }

    const userId = req.params.userId;
    if (!userId) {
        return res.status(400).json({
            success: false,
            message: 'User ID is required'
        });
    }

    const diagnosticResults = {
        success: true,
        userId: userId,
        userFound: false,
        resources: null,
        servers: [],
        issues: [],
        recommendations: []
    };

    try {
        // Check if user exists in database
        const userEmail = await db.get(`email-${userId}`);
        if (!userEmail) {
            diagnosticResults.issues.push('User ID not found in local database');
            diagnosticResults.recommendations.push('Verify user ID is correct or check if user needs to be re-created');
        } else {
            diagnosticResults.userFound = true;
            diagnosticResults.userEmail = userEmail;
            
            // Get user's resources
            try {
                const resources = await calculateResource(userId);
                diagnosticResults.resources = resources;
                
                if (resources.cpu === 0 && resources.memory === 0 && resources.disk === 0) {
                    diagnosticResults.issues.push('User has zero resources - may indicate calculation issues');
                    diagnosticResults.recommendations.push('Check user plan or panel connection issues');
                }
            } catch (resourceError) {
                diagnosticResults.issues.push(`Resource calculation error: ${resourceError.message}`);
                diagnosticResults.recommendations.push('Check panel connection and user server data');
            }
            
            // Check for servers
            try {
                // Check panel connection first
                if (hydrapanel.url && hydrapanel.key) {
                    const servers = await axios.get(`${hydrapanel.url}/api/client/servers`, {
                        headers: {
                            'Authorization': `Bearer ${hydrapanel.key}`,
                            'Accept': 'application/json'
                        },
                        timeout: 8000
                    });
                    
                    if (servers.data && Array.isArray(servers.data.data)) {
                        diagnosticResults.servers = servers.data.data.filter(server => 
                            server.attributes && server.attributes.user === parseInt(userId)
                        ).map(server => ({
                            id: server.attributes.identifier,
                            name: server.attributes.name,
                            status: server.attributes.status
                        }));
                        
                        if (diagnosticResults.servers.length === 0) {
                            diagnosticResults.issues.push('No servers found for this user');
                            diagnosticResults.recommendations.push('Verify user has servers allocated in the panel');
                        }
                    } else {
                        diagnosticResults.issues.push('Invalid server data format returned from panel');
                        diagnosticResults.recommendations.push('Check panel API version compatibility');
                    }
                } else {
                    diagnosticResults.issues.push('Panel connection not configured');
                    diagnosticResults.recommendations.push('Configure panel URL and API key');
                }
            } catch (serverError) {
                diagnosticResults.issues.push(`Server data fetch error: ${serverError.message}`);
                
                // Check for HTML response instead of JSON
                if (serverError.response && serverError.response.data && 
                    typeof serverError.response.data === 'string' && 
                    serverError.response.data.includes('<!DOCTYPE html>')) {
                    diagnosticResults.issues.push('Panel returned HTML instead of JSON for server data request');
                    diagnosticResults.recommendations.push('Check panel URL and API credentials');
                }
                
                diagnosticResults.recommendations.push('Verify panel connection and API permissions');
            }
        }
    } catch (error) {
        diagnosticResults.success = false;
        diagnosticResults.issues.push(`General diagnostic error: ${error.message}`);
    }

    res.json(diagnosticResults);
});

// API route to find user by Discord ID
router.get('/api/find-user-by-discord/:discordId', ensureAuthenticated, async (req, res) => {
    // Check if user is admin
    const isAdmin = await db.get(`admin-${req.user.email}`);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Admin access required'
        });
    }

    const discordId = req.params.discordId;
    if (!discordId) {
        return res.status(400).json({
            success: false,
            message: 'Discord ID is required'
        });
    }

    try {
        // Find the user by Discord ID in the database
        const userKeys = await db.list('id-'); // List all user ID keys
        let foundUserId = null;
        
        // First check if the Discord ID is the user ID (fallback case)
        const discordIdEmail = await db.get(`email-${discordId}`);
        if (discordIdEmail) {
            return res.json({
                success: true,
                userId: discordId,
                email: discordIdEmail
            });
        }
        
        // Otherwise search through all users
        for (const key of userKeys) {
            const userId = key.replace('id-', '');
            const userEmail = await db.get(`email-${userId}`);
            if (!userEmail) continue;
            
            const userDiscordId = await db.get(`discord-${userEmail}`);
            if (userDiscordId === discordId) {
                foundUserId = userId;
                break;
            }
        }

        if (foundUserId) {
            const email = await db.get(`email-${foundUserId}`);
            res.json({
                success: true,
                userId: foundUserId,
                email: email
            });
        } else {
            res.json({
                success: false,
                message: `No user found with Discord ID: ${discordId}`
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Error finding user: ${error.message}`
        });
    }
});

// API route to find user by email
router.get('/api/find-user-by-email/:email', ensureAuthenticated, async (req, res) => {
    // Check if user is admin
    const isAdmin = await db.get(`admin-${req.user.email}`);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            message: 'Unauthorized: Admin access required'
        });
    }

    const email = req.params.email;
    if (!email) {
        return res.status(400).json({
            success: false,
            message: 'Email is required'
        });
    }

    try {
        // Find the user by email in the database
        const userId = await db.get(`id-${email}`);
        
        if (userId) {
            res.json({
                success: true,
                userId: userId,
                email: email
            });
        } else {
            res.json({
                success: false,
                message: `No user found with email: ${email}`
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Error finding user: ${error.message}`
        });
    }
});

// Assets
router.use("/public", express.static("public"));

module.exports = router;
