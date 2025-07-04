const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const { db } = require("../function/db");
const { ensureAuthenticated } = require("../function/ensureAuthenticated.js");

const router = express.Router();

const hydrapanel = {
    url: process.env.PANEL_URL,
    key: process.env.PANEL_KEY,
};

async function sendDiscordNotification(message) {
    const webhookURL = process.env.DISCORD_WEBHOOK_URL;
    const notificationsEnabled =
        process.env.DISCORD_NOTIFICATIONS_ENABLED === "true";

    if (!notificationsEnabled) {
        return;
    }

    if (!webhookURL) {
        log.warn("Discord webhook URL is not set.");
        return;
    }

    const embed = {
        title: "Draco Logging",
        description: message,
        color: 3066993,
        thumbnail: {
            url:
                process.env.EMBED_THUMBNAIL_URL ||
                "https://example.com/default-thumbnail.png",
        },
        timestamp: new Date().toISOString(),
    };

    const data = {
        username: "Dashboard",
        embeds: [embed],
    };

    try {
        await axios.post(webhookURL, data);
    } catch (error) {
        log.error(`❗ Error sending notification to Discord: ${error.message}`);
    }
}

const checkAdmin = async (req, res, next) => {
    const isAdmin = await db.get(`admin-${req.user.email}`);
    if (isAdmin === true) {
        return next(); // Proceed to the requested route
    } else {
        return res.redirect("/dashboard"); // Redirect non-admins to dashboard
    }
};

// Admin
router.get("/admin", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    if ((await db.get(`admin-${req.user.email}`)) == true) {
        res.render("admin", {
            user: req.user, // User info
            coins: await db.get(`coins-${req.user.email}`),
            discordserver: process.env.DISCORD_SERVER,
            req: req, // Request (queries)
            theme: require("../storage/theme.json"),
            admin: await db.get(`admin-${req.user.email}`),
            name: process.env.APP_NAME,
        });
    } else {
        res.redirect("/dashboard");
    }
});

router.post("/add-announcement", checkAdmin, (req, res) => {
    const { title, message, author } = req.body;

    if (!title || !message || !author) {
        return res.status(400).json({ error: "All fields are required." });
    }

    const newAnnouncement = {
        id: Date.now(),
        title,
        message,
        author,
        createdAt: new Date().toISOString(),
    };

    const filePath = path.join(__dirname, "../storage/announcement.json");

    fs.readFile(filePath, "utf8", (err, data) => {
        if (err) {
            return res.status(500).json({ error: "Failed to read file." });
        }

        let announcements = [];
        try {
            announcements = JSON.parse(data || "[]"); // Ensure parsing works with empty files
        } catch (parseErr) {
            return res
                .status(500)
                .json({ error: "Failed to parse announcements." });
        }

        announcements.push(newAnnouncement);

        fs.writeFile(
            filePath,
            JSON.stringify(announcements, null, 2),
            (err) => {
                if (err) {
                    return res
                        .status(500)
                        .json({ error: "Failed to write file." });
                }
                // Respond with success message
                res.status(201).json({
                    message: "Announcement added successfully!",
                });
            },
        );
    });
});

router.post("/add-promocode", checkAdmin, async (req, res) => {
    const { code, maxUses, coins } = req.body;

    if (!code || !maxUses || !coins) {
        return res.status(400).json({ error: "All fields are required." });
    }

    try {
        // Save promo code details to the database
        await db.set(`code-${code}`, {
            maxUses: parseInt(maxUses),
            coins: parseInt(coins),
            uses: 0, // Initialize with 0 uses
        });

        res.status(201).json({ message: "Promo code added successfully!" });
    } catch (err) {
        res.status(500).json({ error: "Failed to add promo code." });
    }
});

router.get("/theme", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    if ((await db.get(`admin-${req.user.email}`)) == true) {
        res.render("admin-theme", {
            user: req.user, // User info
            coins: await db.get(`coins-${req.user.email}`),
            discordserver: process.env.DISCORD_SERVER,
            req: req, // Request (queries)
            theme: require("../storage/theme.json"),
            admin: await db.get(`admin-${req.user.email}`),
            name: process.env.APP_NAME, // App name
        });
    } else {
        res.redirect("/dashboard");
    }
});

router.get("/images", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    if ((await db.get(`admin-${req.user.email}`)) == true) {
        res.render("admin_images", {
            user: req.user, // User info
            coins: await db.get(`coins-${req.user.email}`),
            discordserver: process.env.DISCORD_SERVER,
            theme: require("../storage/theme.json"),
            req: req, // Request (queries)
            admin: await db.get(`admin-${req.user.email}`),
            images: require("../storage/images.json"), // Images data
            name: process.env.APP_NAME, // App name
        });
    } else {
        res.redirect("/dashboard");
    }
});
router.get("/nodes", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    if ((await db.get(`admin-${req.user.email}`)) == true) {
        res.render("admin_nodes", {
            user: req.user, // User info
            coins: await db.get(`coins-${req.user.email}`),
            discordserver: process.env.DISCORD_SERVER,
            theme: require("../storage/theme.json"),
            req: req, // Request (queries)
            admin: await db.get(`admin-${req.user.email}`),
            nodes: require("../storage/nodes.json"), // Images data
            name: process.env.APP_NAME, // App name
        });
    } else {
        res.redirect("/dashboard");
    }
});

// Scan eggs & locations
router.get("/scanimages", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    if ((await db.get(`admin-${req.user.email}`)) == true) {
        try {
            const response = await axios.get(`${hydrapanel.url}/api/images`, {
                headers: {
                    "x-api-key": hydrapanel.key,
                },
            });

            const images = response.data;
            const formattedImages = images.map((image) => ({
                Image: image.Image,
                Cmd: image.Cmd,
                Env: image.Env,
                Scripts: image.Scripts,
                Name: image.Name,
                Description: image.Description,
                Author: image.Author,
                AuthorName: image.AuthorName,
                Meta: image.Meta,
                Id: image.Id,
                Variables: image.Variables,
            }));

            let existingImages = [];
            try {
                const existingImagesData = fs.readFileSync(
                    "storage/images.json",
                );
                existingImages = JSON.parse(existingImagesData);
            } catch (error) {
                console.log("No existing images file found.");
            }

            const allImages = [...existingImages, ...formattedImages];
            fs.writeFileSync(
                "storage/images.json",
                JSON.stringify(formattedImages, null, 2),
            );

            res.redirect("/admin?success=COMPLETE");
        } catch (error) {
            console.error(`Error fetching images: ${error}`);
            res.redirect("/admin?err=FETCH_FAILED");
        }
    } else {
        res.redirect("/dashboard");
    }
});

router.get("/scannodes", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    if ((await db.get(`admin-${req.user.email}`)) == true) {
        try {
            const response = await axios.get(`${hydrapanel.url}/api/nodes`, {
                headers: {
                    "x-api-key": hydrapanel.key,
                },
            });

            const nodes = response.data;
            const formattedNodes = nodes.map((node) => ({
                id: node.id,
                name: node.name,
                tags: node.tags,
                processor: node.processor,
                ram: node.ram,
                disk: node.disk,
            }));

            let existingNodes = [];
            try {
                const existingNodesData = fs.readFileSync("storage/nodes.json");
                existingNodes = JSON.parse(existingNodesData);
            } catch (error) {
                console.log("No existing nodes file found.");
            }

            const allNodes = [...existingNodes, ...formattedNodes];
            fs.writeFileSync(
                "storage/nodes.json",
                JSON.stringify(allNodes, null, 2),
            );

            res.redirect("/admin?success=COMPLETE");
        } catch (error) {
            console.error(`Error fetching nodes: ${error}`);
            res.redirect("/admin?err=FETCH_FAILED");
        }
    } else {
        res.redirect("/dashboard");
    }
});

// Set & Add coins
router.get("/addcoins", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    if ((await db.get(`admin-${req.user.email}`)) == true) {
        const { email, amount } = req.query;

        if (!email || !amount) return res.redirect("/admin?err=INVALIDPARAMS");
        let amountParse =
            parseInt(await db.get(`coins-${email}`)) + parseInt(amount);
        await db.set(`coins-${email}`, amountParse);
        res.redirect("/admin?success=COMPLETE");
        await sendDiscordNotification(
            `Admin Have Added ${amount} of coins in ${email} account.`,
        );
    } else {
        res.redirect("/dashboard");
    }
});

router.get("/setcoins", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    if ((await db.get(`admin-${req.user.email}`)) == true) {
        const { email, amount } = req.query;

        if (!email || !amount) return res.redirect("/admin?err=INVALIDPARAMS");
        let amountParse = parseInt(amount);
        await db.set(`coins-${email}`, amountParse);
        res.redirect("/admin?success=COMPLETE");
        await sendDiscordNotification(
            `Admin Have Set ${amount} of coins in ${email} account.`,
        );
    } else {
        res.redirect("/dashboard");
    }
});

// Set & Add resources
router.get("/addresources", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    if ((await db.get(`admin-${req.user.email}`)) == true) {
        const { email, cpu, ram, disk } = req.query;
        if (!email || !cpu || !ram || !disk)
            return res.redirect("/admin?err=INVALIDPARAMS");

        // Resource amounts
        let cpuAmount = parseInt(cpu) * 100;
        let ramAmount = parseInt(ram) * 1024;
        let diskAmount = parseInt(disk) * 1;

        // Ensure amount are numbers
        if (isNaN(cpuAmount) || isNaN(ramAmount) || isNaN(diskAmount))
            return res.redirect("/admin?err=INVALIDAMOUNT");

        // Current resources
        let currentCpu = parseInt(await db.get(`cpu-${email}`)) || 0;
        let currentRam = parseInt(await db.get(`ram-${email}`)) || 0;
        let currentDisk = parseInt(await db.get(`disk-${email}`)) || 0;

        // Update resources
        await db.set(`cpu-${email}`, currentCpu + cpuAmount);
        await db.set(`ram-${email}`, currentRam + ramAmount);
        await db.set(`disk-${email}`, currentDisk + diskAmount);

        res.redirect("/admin?success=COMPLETE");
    } else {
        res.redirect("/dashboard");
    }
});

router.get("/setresources", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    if ((await db.get(`admin-${req.user.email}`)) == true) {
        const { email, cpu, ram, disk } = req.query;
        if (!email || !cpu || !ram || !disk)
            return res.redirect("/admin?err=INVALIDPARAMS");

        // Resource amounts
        let cpuAmount = parseInt(cpu) * 100;
        let ramAmount = parseInt(ram) * 1024;
        let diskAmount = parseInt(disk) * 1;

        // Ensure amount are numbers
        if (isNaN(cpuAmount) || isNaN(ramAmount) || isNaN(diskAmount))
            return res.redirect("/admin?err=INVALIDAMOUNT");

        // Update resources
        await db.set(`cpu-${email}`, cpuAmount);
        await db.set(`ram-${email}`, ramAmount);
        await db.set(`disk-${email}`, diskAmount);

        res.redirect("/admin?success=COMPLETE");
    } else {
        res.redirect("/dashboard");
    }
});

// Ban & Unban
router.get("/ban", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    if ((await db.get(`admin-${req.user.email}`)) == true) {
        const { email, reason } = req.query;
        if (!email) return res.redirect("/admin?err=INVALIDPARAMS");

        await db.set(`banned-${email}`, reason);
        res.redirect("/admin?success=BANNED");
        await sendDiscordNotification(
            `Admin Have Banned ${email} account With Reason ${reason}.`,
        );
    } else {
        res.redirect("/dashboard");
    }
});

router.get("/unban", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    if ((await db.get(`admin-${req.user.email}`)) == true) {
        const { email } = req.query;
        if (!email) return res.redirect("/admin?err=INVALIDPARAMS");

        await db.delete(`banned-${email}`);
        res.redirect("/admin?success=UNBANNED");
        await sendDiscordNotification(`Admin Have UnBanned ${email}.`);
    } else {
        res.redirect("/dashboard");
    }
});

module.exports = router;
