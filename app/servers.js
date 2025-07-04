const express = require('express');
const axios = require('axios');
const fs = require('fs');

const { db } = require('../function/db');
const { calculateResource } = require('../function/calculateResource');
const { ensureAuthenticated } = require('../function/ensureAuthenticated');
const { getRandomPort } = require('../function/getRandomPort');

const router = express.Router();

const hydrapanel = {
    url: process.env.PANEL_URL,
    key: process.env.PANEL_KEY
};

// Existing resources (the ones in use on servers)
const existingResources = async (userID) => {
    return {
        "cpu": await calculateResource(userID, 'Cpu'),
        "ram": await calculateResource(userID, 'Memory'),
        "disk": await calculateResource(userID, 'Disk')
    };
};

// Max resources (the ones the user has purchased or been given)
const maxResources = async (email) => {
    return {
        "cpu": await db.get(`cpu-${email}`),
        "ram": await db.get(`ram-${email}`),
        "disk": await db.get(`disk-${email}`)
    };
};

// Delete server
router.get('/delete', ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (!req.query.id) return res.redirect('../dashboard?err=MISSINGPARAMS');
    try {
        const userId = await db.get(`id-${req.user.email}`);
        const serverId = req.query.id;

        const server = await axios.post(`${hydrapanel.url}/api/getInstance`, {
            id: serverId
        }, {
            headers: {
                'x-api-key': hydrapanel.key
            }
        });
        console.log(server.data)

        if (server.data.User !== userId) return res.redirect('../dashboard?err=DONOTOWN');

        await axios.delete(`${hydrapanel.url}/api/instance/delete`, {
            headers: {
                'x-api-key': hydrapanel.key
            },
            data: {
                id: serverId
            }
        });

        res.redirect('/dashboard?success=DELETE');
    } catch (error) {
        if (error.response && error.response.status === 404) return res.redirect('../dashboard?err=NOTFOUND');

        console.error(error);
        res.redirect('../dashboard?err=INTERNALERROR');
    }
});

// Create server
router.get('/create', ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    if (!req.query.name || !req.query.imageName || !req.query.node || !req.query.image || !req.query.cpu || !req.query.ram || !req.query.variables) return res.redirect('../create-server?err=MISSINGPARAMS'); //  || !req.query.disk

    // Check if user has enough resources to create a server
    const max = await maxResources(req.user.email);
    const existing = await existingResources(req.user.id);

    if (parseInt(req.query.cpu) > parseInt(max.cpu - existing.cpu)) return res.redirect('../create-server?err=NOTENOUGHRESOURCES');
    if (parseInt(req.query.ram) > parseInt(max.ram - existing.ram)) return res.redirect('../create-server?err=NOTENOUGHRESOURCES');
    if (parseInt(req.query.disk) > parseInt(max.disk - existing.disk)) return res.redirect('../create-server?err=NOTENOUGHRESOURCES');
    // if (parseInt(req.query.disk) > parseInt(max.disk - existing.disk)) return res.redirect('../create-server?err=NOTENOUGHRESOURCES');

    // Ensure resources are above 128MB / 1 core
    if (parseInt(req.query.ram) < 128) return res.redirect('../create-server?err=INVALID_RAM');
    if (parseInt(req.query.disk) < 1) return res.redirect('../create-server?err=INVALID_DISK');
    if (parseInt(req.query.cpu) < 1) return res.redirect('../create-server?err=INVALID_CPU');
    // if (parseInt(req.query.disk) < 128) return res.redirect('../create-server?err=INVALID');

    // Name checks
    if (req.query.name.length > 100) return res.redirect('../create-server?err=INVALID_NAME');
    if (req.query.name.length < 3) return res.redirect('../create-server?err=INVALID_NAME');

    // Make sure node, image, resources are numbers
    if (isNaN(req.query.cpu) || isNaN(req.query.ram)) return res.redirect('../create-server?err=INVALID_RAM'); // || isNaN(req.query.disk) || isNaN(req.query.node) || isNaN(req.query.image) ||
    if (req.query.cpu < 0 || req.query.ram < 1) return res.redirect('../create-server?err=INVALID_CPU'); // || req.query.disk < 1

    try {
        // Ensure the user exists in the panel and get the correct userId
        let userId = await db.get(`id-${req.user.email}`);
        
        if (!userId) {
            // If no user ID, we need to create one first
            console.log(`No user ID found for ${req.user.email}. Creating user in panel before server creation...`);
            // Import the checkAccount function if not already available in this file
            const { checkAccount } = require("../app/auth");
            await checkAccount(req.user.email, req.user.username, req.user.id);
            
            // Get the newly created userId
            userId = await db.get(`id-${req.user.email}`);
            
            // If still no userId, use the Discord ID as fallback
            if (!userId) {
                console.warn(`Failed to create user in panel. Using Discord ID as fallback.`);
                userId = req.user.id;
                // Store the Discord ID in our database as a fallback
                await db.set(`id-${req.user.email}`, userId);
            }
        }
        
        const name = req.query.name;
        const nodeId = req.query.node;
        const imageId = req.query.image;
        const imageName = req.query.imageName;
        const variables = req.query.variables;
        const cpu = parseInt(req.query.cpu);
        const memory = parseInt(req.query.ram);
        const disk = parseInt(req.query.disk);
        // const disk = parseInt(req.query.disk); 

        const portsData = require('../storage/ports.json');

        const selectedPortKey = getRandomPort(portsData.portAvailable);
        const selectedPort = portsData.portAvailable[selectedPortKey];
        if (!selectedPort || !selectedPortKey) {
            console.error('No ports available');
            res.redirect('../create-server?error=no_ports_available')
        }
        const [, number2] = selectedPort.split(':');

        const primaryport = number2;

        portsData.portInUse[selectedPortKey] = selectedPort;
        delete portsData.portAvailable[selectedPortKey];

        fs.writeFileSync('./storage/ports.json', JSON.stringify(portsData, null, 2), 'utf-8');

        const images = require('../storage/images.json');

        // Find the image by its Id
        const image2 = images.find(image => image.Id === imageId);

        if (!image2) {
            return res.redirect('../create-server?err=INVALID_IMAGE');
        }

        const image = image2.Image;
        console.log(`Creating server for user ${userId}`);
        
        // Create the server with the properly verified userId
        await axios.post(`${hydrapanel.url}/api/instances/deploy`, {
            image,
            imagename: imageName,
            memory,
            disk,
            cpu,
            ports: selectedPort,
            nodeId,
            name,
            user: userId,
            primary: primaryport,
            variables: variables
        }, {
            headers: {
                'x-api-key': hydrapanel.key
            }
        });
        
        const cpuKey = `cpu-${req.user.email}`;
        const ramKey = `ram-${req.user.email}`;
        const diskKey = `disk-${req.user.email}`;
        const serverKey = `server-${req.user.email}`;

        const cpuValue = await db.get(cpuKey);
        const ramValue = await db.get(ramKey);
        const diskValue = await db.get(diskKey);
        const serverValue = await db.get(serverKey);

        if (cpuValue === null || ramValue === null || serverValue === null) {
            return res.status(404).send('User resources not found');
        }

        // Check if there are enough resources to subtract
        if (cpuValue < cpu || ramValue < memory || serverValue <= 0) {
            return res.status(400).send('Insufficient resources');
        }

        // Subtract the values
        await db.set(cpuKey, cpuValue - cpu);  // Subtract CPU
        await db.set(ramKey, ramValue - memory);  // Subtract RAM
        await db.set(diskKey, diskValue - disk);  // Subtract DISK
        await db.set(serverKey, serverValue - 1);  // Subtract 1 from server

        res.redirect('../dashboard?success=CREATED');
    } catch (error) {
        console.error(error);
        res.redirect('../create-server?err=ERRORONCREATE');
    }
});

router.get('/servers', ensureAuthenticated, async (req, res) => {
    try {
        if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
        console.log("init servers");
        
        // Initialize servers as empty array
        let servers = [];
        
        try {
            // Ensure user exists in the panel
            const userId = await db.get(`id-${req.user.email}`);
            
            if (!userId) {
                // If no user ID, we need to create one first
                console.log(`No user ID found for ${req.user.email}. Creating user in panel...`);
                // Import the checkAccount function if not already available in this file
                const { checkAccount } = require("../app/auth");
                await checkAccount(req.user.email, req.user.username, req.user.id);
            }
            
            // Get the user ID (which might have just been created)
            const finalUserId = await db.get(`id-${req.user.email}`);
            
            // Now load servers with the validated user ID
            const response = await axios.post(`${hydrapanel.url}/api/getUserInstance`, {
                userId: finalUserId
            }, {
                headers: {
                    'x-api-key': hydrapanel.key
                },
                timeout: 15000 // Increased timeout
            });

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
            
            console.log(`Loaded ${servers.length} verified servers for user ${finalUserId}`);

            // Calculate existing and maximum resources
            res.render('servers', {
                coins: await db.get(`coins-${req.user.email}`), // User's coins
                req: req, // Request (queries)
                name: process.env.APP_NAME || "Draco", // Dashboard name
                panel: process.env.PANEL_URL,
                user: req.user, // User info
                servers, // Validated servers the user owns
                admin: await db.get(`admin-${req.user.email}`) || false // Admin status
            });
        } catch (err) {
            console.error("Error fetching server data:", err.message);
            
            // Render servers page with empty servers array
            res.render('servers', {
                coins: await db.get(`coins-${req.user.email}`),
                req: req,
                name: process.env.APP_NAME || "Draco",
                panel: process.env.PANEL_URL,
                user: req.user,
                servers: [], // Empty array when error occurs
                admin: await db.get(`admin-${req.user.email}`) || false
            });
        }
    } catch (err) {
        console.error("Unexpected error in servers route:", err);
        res.redirect('/?err=INTERNALERROR');
    }
});

router.get('/create-server', ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id) return res.redirect('/login/discord');
    res.render('create', {
        req: req, // Requests (queries) 
        name: process.env.APP_NAME, // Dashboard name
        user: req.user, // User info (if logged in)
        admin: await db.get(`admin-${req.user.email}`), // Admin status
        coins: await db.get(`coins-${req.user.email}`), // Coins
        images: require('../storage/images.json'), // Images data
        nodes: require('../storage/nodes.json') // Nodes data
    });
});

module.exports = router;
