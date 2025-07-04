const express = require('express');
const Keyv = require('keyv');
require('dotenv').config(); 
const axios = require('axios');
const randomstring = require('randomstring');

const router = express.Router();

const keyv = new Keyv('sqlite://storage/database.sqlite'); 

function authenticate(req, res, next) {
    const apiKey = req.query.key;
    if (apiKey && apiKey === process.env.API_KEY) {
        next();
    } else {
        res.status(403).json({ error: "Forbidden: Invalid API Key" });
    }
}

async function getUserInfo(email) {
    const keys = {
        cpu: `cpu-${email}`,
        ram: `ram-${email}`,
        disk: `disk-${email}`,
        server: `server-${email}`,
        id: `id-${email}`,
    };

    const data = {};
    for (const [key, value] of Object.entries(keys)) {
        data[key] = await keyv.get(value);
    }

    return data;
}

router.get('/application/user/info', authenticate, async (req, res) => {
    const email = req.query.email;

    if (!email) {
        return res.status(400).json({ error: "Missing email parameter" });
    }

    try {
        const userInfo = await getUserInfo(email);
        res.json({ email, ...userInfo });
    } catch (error) {
        res.status(500).json({ error: "Query execution failed", details: error.message });
    }
});

// Add a new endpoint to create and verify panel users
router.post('/verify-panel-user', authenticate, async (req, res) => {
    try {
        const { email, username, discordId } = req.body;

        if (!email || !username || !discordId) {
            return res.status(400).json({ 
                success: false, 
                error: "Missing required parameters. Need email, username, and discordId." 
            });
        }

        // Check if user already exists in our database
        const existingUserId = await keyv.get(`id-${email}`);
        
        // If we have a user ID stored, verify it's valid by checking with the panel
        if (existingUserId) {
            try {
                // Query HydraPanel to see if the user ID is valid
                const response = await axios.post(
                    `${process.env.PANEL_URL}/api/getUser`,
                    {
                        type: "id",
                        value: existingUserId
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                            "x-api-key": process.env.PANEL_KEY
                        },
                        timeout: 15000
                    }
                );
                
                if (response.data?.userId) {
                    // User exists in HydraPanel, return success
                    return res.json({
                        success: true,
                        userId: response.data.userId,
                        message: "User already exists and is verified in HydraPanel"
                    });
                }
            } catch (err) {
                console.log(`Stored user ID ${existingUserId} is not valid in HydraPanel. Creating new account...`);
                // Continue to create a new user if verification fails
            }
        }

        // If we don't have a valid user ID, create one
        // Generate a random password
        const password = randomstring.generate({
            length: parseInt(process.env.PASSWORD_LENGTH) || 16,
            charset: "alphanumeric"
        });

        try {
            // Attempt to create the user in HydraPanel
            const createResponse = await axios.post(
                `${process.env.PANEL_URL}/api/auth/create-user`,
                {
                    username: username,
                    email: email,
                    password: password,
                    userId: discordId
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key": process.env.PANEL_KEY
                    },
                    timeout: 15000
                }
            );

            let userId;
            
            // If HydraPanel gives us a user ID, use it
            if (createResponse.data?.userId) {
                userId = createResponse.data.userId;
            } 
            // If not but the creation was successful, use Discord ID as fallback
            else if (createResponse.status >= 200 && createResponse.status < 300) {
                userId = discordId;
                console.log(`HydraPanel did not return a user ID. Using Discord ID ${discordId} as fallback.`);
            } else {
                return res.status(500).json({
                    success: false,
                    error: "Unexpected response from HydraPanel during user creation"
                });
            }

            // Store the credentials in our database
            await Promise.all([
                keyv.set(`password-${email}`, password),
                keyv.set(`id-${email}`, userId)
            ]);

            return res.json({
                success: true,
                userId: userId,
                message: "User created successfully in HydraPanel"
            });
        } catch (err) {
            // Check for user already exists error
            if (err.response?.status === 409) {
                // User already exists, try to get their ID
                try {
                    const retryResponse = await axios.post(
                        `${process.env.PANEL_URL}/api/getUser`,
                        {
                            type: "email",
                            value: email
                        },
                        {
                            headers: {
                                "Content-Type": "application/json",
                                "x-api-key": process.env.PANEL_KEY
                            },
                            timeout: 15000
                        }
                    );
                    
                    // If we get a valid user ID, store it
                    if (retryResponse.data?.userId) {
                        await keyv.set(`id-${email}`, retryResponse.data.userId);
                        
                        return res.json({
                            success: true,
                            userId: retryResponse.data.userId,
                            message: "User already exists in HydraPanel, ID retrieved successfully"
                        });
                    }
                } catch (retryErr) {
                    console.warn(`Failed to retrieve ID after conflict: ${retryErr.message}`);
                }
                
                // If we can't get the user ID, use Discord ID as fallback
                await keyv.set(`id-${email}`, discordId);
                await keyv.set(`password-${email}`, password);
                
                return res.json({
                    success: true,
                    userId: discordId,
                    message: "User exists in HydraPanel but ID couldn't be retrieved. Using Discord ID as fallback."
                });
            }
            
            // For other errors, store Discord ID as fallback and return error
            await keyv.set(`id-${email}`, discordId);
            await keyv.set(`password-${email}`, password);
            
            return res.status(500).json({
                success: false,
                userId: discordId, // Provide Discord ID as fallback
                error: err.message,
                message: "Error during HydraPanel user creation. Using Discord ID as fallback."
            });
        }
    } catch (error) {
        console.error("Error in verify-panel-user endpoint:", error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
