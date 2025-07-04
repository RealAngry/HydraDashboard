const express = require("express");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

const { db } = require("../function/db");
const { ensureAuthenticated } = require("../function/ensureAuthenticated.js");

const router = express.Router();

// Add this function at the top of your file
function generateReferralCode(userId) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${code}_${userId}`;
}

const resourceCosts = {
    cpu: process.env.CPU_COST,
    ram: process.env.RAM_COST,
    disk: process.env.DISK_COST,
    backup: process.env.BACKUP_COST,
    database: process.env.DATABASE_COST,
    allocation: process.env.ALLOCATION_COST,
};

let earners = {};

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
        color: 3066993, // Green color
        thumbnail: {
            url:
                process.env.EMBED_THUMBNAIL_URL ||
                "https://example.com/default-thumbnail.png", // Default thumbnail URL
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

// Linkvertise configuration
const LINKVERTISE = {
    ENABLED: process.env.LINKVERTISE_ENABLED === "true",
    USER_ID: process.env.LINKVERTISE_USER_ID,
    API_KEY: process.env.LINKVERTISE_API_KEY,
    BASE_URL: "https://linkvertise.com",
    REWARD_AMOUNT: parseInt(process.env.LINKVERTISE_REWARD_AMOUNT) || 5,
    DAILY_LIMIT: parseInt(process.env.LINKVERTISE_DAILY_LIMIT) || 3,
};

// ... [rest of your existing code remains exactly the same] ...

module.exports = router;
// Afk

router.ws("/afkwspath", async (ws, req) => {
    if (!req.user || !req.user.email || !req.user.id) return ws.close();
    if (earners[req.user.email] == true) return ws.close();
    const timeConf = process.env.AFK_TIME;
    let time = timeConf;
    earners[req.user.email] = true;
    let aba = setInterval(async () => {
        if (earners[req.user.email] == true) {
            time--;
            if (time <= 0) {
                time = timeConf;
                ws.send(JSON.stringify({ type: "coin" }));
                let r = parseInt(await db.get(`coins-${req.user.email}`)) + 1;
                await db.set(`coins-${req.user.email}`, r);
            }
            ws.send(JSON.stringify({ type: "count", amount: time }));
        }
    }, 1000);
    ws.on("close", async () => {
        delete earners[req.user.email];
        clearInterval(aba);
    });
});

router.get("/afk", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");
    res.render("afk", {
        user: req.user, // User info
        coins: await db.get(`coins-${req.user.email}`), // User's coins
        discordserver: process.env.DISCORD_SERVER,
        req: req, // Request (queries)
        admin: await db.get(`admin-${req.user.email}`), // Admin status
        theme: require("../storage/theme.json"), // Theme data
        name: process.env.APP_NAME, // App name
    });
});

router.get("/transfer", async (req, res) => {
    if (!req.user) return res.redirect("/");
    const email = req.user.email;
    const coinsKey = `coins-${email}`;

    let coins = await db.get(coinsKey);

    if (!coins) {
        coins = 0;
        await db.set(coinsKey, coins);
    }
    res.render("transfer", {
        req,
        coins,
        user: req.user,
        users: (await db.get("users")) || [],
        name: (await db.get("name")) || "Draco",
        logo: (await db.get("logo")) || false,
    });
});

router.get("/transfercoins", async (req, res) => {
    if (!req.user) return res.redirect(`/`);

    const coins = parseInt(req.query.coins);
    if (!coins || !req.query.email)
        return res.redirect(`/transfer?err=MISSINGFIELDS`);
    if (req.query.email.includes(`${req.user.email}`))
        return res.redirect(`/transfer?err=CANNOTGIFTYOURSELF`);

    if (coins < 1) return res.redirect(`/transfer?err=TOOLOWCOINS`);

    const usercoins = await db.get(`coins-${req.user.email}`);
    const othercoins = await db.get(`coins-${req.query.email}`);

    if (!othercoins) {
        return res.redirect(`/transfer?err=USERDOESNTEXIST`);
    }
    if (usercoins < coins) {
        return res.redirect(`/transfer?err=CANTAFFORD`);
    }

    await db.set(`coins-${req.query.email}`, othercoins + coins);
    await db.set(`coins-${req.user.email}`, usercoins - coins);
    return res.redirect(`/transfer?err=success`);
});

// Store

const plansFilePath = path.join(__dirname, "../storage/plans.json");
const plansJson = fs.readFileSync(plansFilePath, "utf-8");
const plans = JSON.parse(plansJson);

router.get("/store", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id)
        return res.redirect("/login/discord");

    const userCurrentPlan = await db.get(`plan-${req.user.email}`);

    const resourcePlans = Object.values(plans.PLAN).map((plan) => {
        return {
            ...plan,
            hasPlan: userCurrentPlan === plan.name.toUpperCase(),
        };
    });
    res.render("store", {
        user: req.user, // User info
        coins: await db.get(`coins-${req.user.email}`), // User's coins
        req: req, // Request (queries)
        discordserver: process.env.DISCORD_SERVER,
        admin: await db.get(`admin-${req.user.email}`), // Admin status
        name: process.env.APP_NAME, // App name
        resourceCosts: resourceCosts, // Cost Ressources
        theme: require("../storage/theme.json"), // Theme data
        resourcePlans: resourcePlans, // List plans
    });
});

router.get("/buyresource", ensureAuthenticated, async (req, res) => {
    if (!req.query.resource || !req.query.amount)
        return res.redirect("/store?err=MISSINGPARAMS");

    // Ensure amount is a number and is below 10
    if (isNaN(req.query.amount) || req.query.amount > 10)
        return res.redirect("/store?err=INVALIDAMOUNT");

    // Ensure resource is a valid one
    if (
        req.query.resource != "cpu" &&
        req.query.resource != "ram" &&
        req.query.resource != "disk"
    )
        return res.redirect("/store?err=INVALIDRESOURCE");

    let coins = await db.get(`coins-${req.user.email}`);
    let currentResources = await db.get(
        `${req.query.resource}-${req.user.email}`,
    );

    // Resource amounts & costs
    if (req.query.resource == "cpu") {
        let resourceAmount = 100 * req.query.amount;
        let resourceCost = resourceCosts.cpu * req.query.amount;

        if (coins < resourceCost)
            return res.redirect("/store?err=NOTENOUGHCOINS");
        await db.set(
            `cpu-${req.user.email}`,
            parseInt(currentResources) + parseInt(resourceAmount),
        );
        await db.set(
            `coins-${req.user.email}`,
            parseInt(coins) - parseInt(resourceCost),
        );
        return res.redirect("/store?success=BOUGHTRESOURCE");
    } else if (req.query.resource == "ram") {
        let resourceAmount = 1024 * req.query.amount;
        let resourceCost = resourceCosts.ram * req.query.amount;

        if (coins < resourceCost)
            return res.redirect("/store?err=NOTENOUGHCOINS");
        await db.set(
            `ram-${req.user.email}`,
            parseInt(currentResources) + parseInt(resourceAmount),
        );
        await db.set(
            `coins-${req.user.email}`,
            parseInt(coins) - parseInt(resourceCost),
        );
        return res.redirect("/store?success=BOUGHTRESOURCE");
    } else if (req.query.resource == "disk") {
        let resourceAmount = 1 * req.query.amount;
        let resourceCost = resourceCosts.disk * req.query.amount;

        if (coins < resourceCost)
            return res.redirect("/store?err=NOTENOUGHCOINS");
        await db.set(
            `disk-${req.user.email}`,
            parseInt(currentResources) + parseInt(resourceAmount),
        );
        await db.set(
            `coins-${req.user.email}`,
            parseInt(coins) - parseInt(resourceCost),
        );
        return res.redirect("/store?success=BOUGHTRESOURCE");
    }
});

router.post("/claim-promocode", async (req, res) => {
    const { code } = req.body;
    const email = req.user.email; // Assuming user's email is available

    if (!code || !email) {
        return res.status(400).json({ error: "Code is required." });
    }

    // Fetch promo code data from the database
    const promoData = await db.get(`code-${code}`);
    if (!promoData) {
        return res.status(404).json({ error: "Invalid promo code." });
    }

    // Check if the promo code has reached max uses
    if (promoData.uses >= promoData.maxUses) {
        return res
            .status(400)
            .json({ error: "Sorry, this code has reached the max limit." });
    }

    // Check if the user has already claimed this promo code
    const claimedCodes = (await db.get(`claimed_codes-${email}`)) || [];

    // If the code has already been claimed, return an error
    if (claimedCodes.includes(code)) {
        return res
            .status(400)
            .json({ error: "You have already claimed this promo code." });
    }

    // Increment the usage count
    await db.set(`code-${code}.uses`, promoData.uses + 1);

    // Prepare coins to add
    const coins = promoData.coins;

    // Add coins to the user's account
    try {
        // Get current coins or default to 0
        let currentCoins = parseInt(await db.get(`coins-${email}`)) || 0;

        // Calculate new amount
        let amountParse = currentCoins + parseInt(coins);

        // Update the user's coins in the database
        await db.set(`coins-${email}`, amountParse);

        // Update the claimed codes for the user
        claimedCodes.push(code);
        await db.set(`claimed_codes-${email}`, claimedCodes);

        // Respond with success message and new amount
        res.status(200).json({
            message: "Promo code claimed successfully!",
            newAmount: amountParse,
        });
    } catch (error) {
        res.status(500).json({
            error: "Failed to Add Coins",
            details: error.message,
        });
    }
});

// Buy plan
router.get("/buyplan", ensureAuthenticated, async (req, res) => {
    if (!req.query.plan) return res.redirect("/upgrade?err=MISSINGPARAMS");

    const planId = parseInt(req.query.plan);
    if (isNaN(planId)) return res.redirect("/upgrade?err=INVALIDPLAN");

    // Filter
    let selectedPlan = null;
    let selectedPlanName = "";
    for (const key in plans.PLAN) {
        if (plans.PLAN[key].id === planId) {
            selectedPlan = plans.PLAN[key];
            selectedPlanName = key.toUpperCase();
            break;
        }
    }

    // Ensure plan is a valid one
    if (!selectedPlan) return res.redirect("/upgrade?err=INVALIDPLAN");

    let coins = await db.get(`coins-${req.user.email}`);
    let currentPlan = await db.get(`plan-${req.user.email}`);

    // Plan costs
    let planCost = selectedPlan.price;
    if (coins < planCost) return res.redirect("/upgrade?err=NOTENOUGHCOINS");
    if (currentPlan == selectedPlanName)
        return res.redirect("/upgrade?err=ALREADYPLAN");

    try {
        await db.set(`plan-${req.user.email}`, selectedPlanName);
        await db.set(
            `coins-${req.user.email}`,
            parseInt(coins) - parseInt(planCost),
        );

        // Set resources of plan
        const resources = selectedPlan.resources;
        for (const resource in resources) {
            await db.set(`${resource}-${req.user.email}`, resources[resource]);
        }
        return res.redirect("/store?success=BOUGHTPLAN");
    } catch (error) {
        console.error("Error buying plan:", error);
        return res.redirect("/store?err=INTERNALERROR");
    }
});

// Add these routes to your existing router

// Referral Dashboard with Custom Code Creation
router.get("/referrals", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id) {
        return res.redirect("/login/discord");
    }

    const referralCodes =
        (await db.get(`user_referral_codes-${req.user.email}`)) || [];
    const defaultReferralCode =
        (await db.get(`referral_code-${req.user.email}`)) ||
        generateReferralCode(req.user.id);
    const referredUsers =
        (await db.get(`referred_users-${req.user.email}`)) || [];
    const referralRewards =
        (await db.get(`referral_rewards-${req.user.email}`)) || 0;
    const referralLink = `${process.env.BASE_URL || req.protocol + "://" + req.get("host")}/login/discord?ref=${defaultReferralCode}`;
    const maxCodes = parseInt(process.env.MAX_REFERRAL_CODES) || 3;

    res.render("referrals", {
        user: req.user,
        coins: await db.get(`coins-${req.user.email}`),
        defaultReferralCode,
        referralCodes,
        referralLink,
        referredUsers,
        referralRewards,
        referralBonus: parseInt(process.env.REFERRAL_BONUS) || 5,
        maxCodes,
        discordserver: process.env.DISCORD_SERVER,
        admin: await db.get(`admin-${req.user.email}`),
        theme: require("../storage/theme.json"),
        name: process.env.APP_NAME,
        req: req,
    });
});

// Create Custom Referral Code
router.post("/create-referral-code", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { customCode } = req.body;
    const maxCodes = parseInt(process.env.MAX_REFERRAL_CODES) || 3;
    const existingCodes =
        (await db.get(`user_referral_codes-${req.user.email}`)) || [];

    // Validation
    if (!customCode || customCode.length < 4 || customCode.length > 20) {
        return res
            .status(400)
            .json({ error: "Code must be 4-20 characters long" });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(customCode)) {
        return res.status(400).json({
            error: "Only letters, numbers, hyphens and underscores allowed",
        });
    }

    if (existingCodes.length >= maxCodes) {
        return res
            .status(400)
            .json({ error: `You can only create ${maxCodes} custom codes` });
    }

    if (existingCodes.some((code) => code.code === customCode)) {
        return res.status(400).json({ error: "This code already exists" });
    }

    // Check if code is globally unique
    const existingOwner = await db.get(`referral_email-${customCode}`);
    if (existingOwner) {
        return res.status(400).json({ error: "This code is already in use" });
    }

    try {
        // Add to user's custom codes
        const newCode = {
            code: customCode,
            createdAt: new Date().toISOString(),
            uses: 0,
        };

        existingCodes.push(newCode);
        await db.set(`user_referral_codes-${req.user.email}`, existingCodes);

        // Map code to user
        await db.set(`referral_email-${customCode}`, req.user.email);

        res.json({
            success: true,
            message: "Custom referral code created!",
            newCode,
        });
    } catch (error) {
        console.error("Error creating referral code:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Apply Referral Code (for logged-in users)
router.post("/apply-referral-code", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ error: "Code is required" });
    }

    try {
        // Check if user already used a referral code
        const hasUsedCode = await db.get(
            `used_referral_code-${req.user.email}`,
        );
        if (hasUsedCode) {
            return res
                .status(400)
                .json({ error: "You've already used a referral code" });
        }

        // Find referrer
        const referrerEmail = await db.get(`referral_email-${code}`);
        if (!referrerEmail) {
            return res.status(404).json({ error: "Invalid referral code" });
        }

        // Can't refer yourself
        if (referrerEmail === req.user.email) {
            return res
                .status(400)
                .json({ error: "You can't use your own referral code" });
        }

        // Check if this user was already referred by this referrer
        const referredUsers =
            (await db.get(`referred_users-${referrerEmail}`)) || [];
        if (referredUsers.includes(req.user.email)) {
            return res
                .status(400)
                .json({ error: "You've already been referred by this user" });
        }

        // Process referral
        referredUsers.push(req.user.email);
        await db.set(`referred_users-${referrerEmail}`, referredUsers);

        // Update custom code stats if applicable
        const referrerCodes =
            (await db.get(`user_referral_codes-${referrerEmail}`)) || [];
        const usedCodeIndex = referrerCodes.findIndex((c) => c.code === code);
        if (usedCodeIndex !== -1) {
            referrerCodes[usedCodeIndex].uses += 1;
            await db.set(`user_referral_codes-${referrerEmail}`, referrerCodes);
        }

        // Give rewards
        const referralBonus = parseInt(process.env.REFERRAL_BONUS) || 5;
        const referrerCoins = (await db.get(`coins-${referrerEmail}`)) || 0;
        await db.set(`coins-${referrerEmail}`, referrerCoins + referralBonus);

        // Update total rewards given
        const referralRewards =
            (await db.get(`referral_rewards-${referrerEmail}`)) || 0;
        await db.set(
            `referral_rewards-${referrerEmail}`,
            referralRewards + referralBonus,
        );

        // Mark that this user has used a code
        await db.set(`used_referral_code-${req.user.email}`, true);

        // Optional: Give bonus to referred user too
        const userBonus = parseInt(process.env.REFERRED_USER_BONUS) || 0;
        if (userBonus > 0) {
            const userCoins = (await db.get(`coins-${req.user.email}`)) || 0;
            await db.set(`coins-${req.user.email}`, userCoins + userBonus);
        }

        // Send notification
        sendDiscordNotification(
            `🎉 New referral! ${req.user.email} applied ${referrerEmail}'s code "${code}"`,
        );

        res.json({
            success: true,
            message: `Referral code applied successfully!`,
            bonusReceived: userBonus,
        });
    } catch (error) {
        console.error("Error applying referral code:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Delete Custom Referral Code
router.post("/delete-referral-code", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ error: "Code is required" });
    }

    try {
        const existingCodes =
            (await db.get(`user_referral_codes-${req.user.email}`)) || [];
        const codeIndex = existingCodes.findIndex((c) => c.code === code);

        if (codeIndex === -1) {
            return res.status(404).json({ error: "Code not found" });
        }

        // Remove code from user's list
        existingCodes.splice(codeIndex, 1);
        await db.set(`user_referral_codes-${req.user.email}`, existingCodes);

        // Remove global mapping
        await db.delete(`referral_email-${code}`);

        res.json({
            success: true,
            message: "Referral code deleted",
        });
    } catch (error) {
        console.error("Error deleting referral code:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Linkvertise Dashboard
router.get("/linkvertise", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id) {
        return res.redirect("/login/discord");
    }

    // Get user's Linkvertise stats
    const linkvertiseStats = (await db.get(
        `linkvertise_stats-${req.user.email}`,
    )) || {
        totalEarned: 0,
        todayEarned: 0,
        todayLinks: 0,
        lastClaimDate: null,
        allTimeLinks: 0,
    };

    // Check if it's a new day to reset daily limits
    const today = new Date().toDateString();
    if (linkvertiseStats.lastClaimDate !== today) {
        linkvertiseStats.todayEarned = 0;
        linkvertiseStats.todayLinks = 0;
        linkvertiseStats.lastClaimDate = today;
        await db.set(`linkvertise_stats-${req.user.email}`, linkvertiseStats);
    }

    // Generate a unique Linkvertise URL for this user
    const linkvertiseUrl = LINKVERTISE.ENABLED
        ? `${LINKVERTISE.BASE_URL}/${LINKVERTISE.USER_ID}/your-content-path?user=${req.user.id}`
        : null;

    res.render("linkvertise", {
        user: req.user,
        coins: await db.get(`coins-${req.user.email}`),
        linkvertiseUrl,
        linkvertiseStats,
        rewardAmount: LINKVERTISE.REWARD_AMOUNT,
        dailyLimit: LINKVERTISE.DAILY_LIMIT,
        remainingToday: LINKVERTISE.DAILY_LIMIT - linkvertiseStats.todayLinks,
        enabled: LINKVERTISE.ENABLED,
        discordserver: process.env.DISCORD_SERVER,
        admin: await db.get(`admin-${req.user.email}`),
        theme: require("../storage/theme.json"),
        name: process.env.APP_NAME,
        req: req,
    });
});

// API Endpoint to verify Linkvertise completion
router.post("/verify-linkvertise", ensureAuthenticated, async (req, res) => {
    if (!req.user || !req.user.email || !req.user.id) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (!LINKVERTISE.ENABLED) {
        return res
            .status(400)
            .json({ error: "Linkvertise is currently disabled" });
    }

    try {
        // Get user's current stats
        const linkvertiseStats = (await db.get(
            `linkvertise_stats-${req.user.email}`,
        )) || {
            totalEarned: 0,
            todayEarned: 0,
            todayLinks: 0,
            lastClaimDate: null,
            allTimeLinks: 0,
        };

        // Check daily limit
        if (linkvertiseStats.todayLinks >= LINKVERTISE.DAILY_LIMIT) {
            return res.status(400).json({
                error: "You've reached your daily limit for Linkvertise rewards",
            });
        }

        // In a real implementation, you would verify with Linkvertise API here
        // For now, we'll simulate successful verification
        const verified = true; // Replace with actual API call

        if (!verified) {
            return res
                .status(400)
                .json({ error: "Could not verify Linkvertise completion" });
        }

        // Update stats
        linkvertiseStats.todayLinks += 1;
        linkvertiseStats.todayEarned += LINKVERTISE.REWARD_AMOUNT;
        linkvertiseStats.totalEarned += LINKVERTISE.REWARD_AMOUNT;
        linkvertiseStats.allTimeLinks += 1;
        linkvertiseStats.lastClaimDate = new Date().toDateString();

        await db.set(`linkvertise_stats-${req.user.email}`, linkvertiseStats);

        // Add coins to user
        const currentCoins =
            parseInt(await db.get(`coins-${req.user.email}`)) || 0;
        await db.set(
            `coins-${req.user.email}`,
            currentCoins + LINKVERTISE.REWARD_AMOUNT,
        );

        res.json({
            success: true,
            message: `Successfully claimed ${LINKVERTISE.REWARD_AMOUNT} coins!`,
            newBalance: currentCoins + LINKVERTISE.REWARD_AMOUNT,
            stats: linkvertiseStats,
        });
    } catch (error) {
        console.error("Linkvertise verification error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Admin endpoint to sync with Linkvertise API (cron job can call this)
router.get("/admin/sync-linkvertise", async (req, res) => {
    // Verify admin permissions
    if (!req.user || !(await db.get(`admin-${req.user.email}`))) {
        return res.status(403).json({ error: "Forbidden" });
    }

    try {
        // This would make an actual API call to Linkvertise to get conversions
        // For now, we'll simulate it
        const mockApiResponse = {
            success: true,
            conversions: [
                // Mock data - in reality this would come from Linkvertise API
                {
                    user_id: "123",
                    amount: 5,
                    timestamp: new Date().toISOString(),
                },
                {
                    user_id: "456",
                    amount: 5,
                    timestamp: new Date().toISOString(),
                },
            ],
        };

        // Process each conversion
        for (const conversion of mockApiResponse.conversions) {
            const userEmail = await db.get(
                `user_email_by_id-${conversion.user_id}`,
            );
            if (userEmail) {
                const linkvertiseStats = (await db.get(
                    `linkvertise_stats-${userEmail}`,
                )) || {
                    totalEarned: 0,
                    todayEarned: 0,
                    todayLinks: 0,
                    lastClaimDate: null,
                    allTimeLinks: 0,
                };

                // Update stats
                linkvertiseStats.totalEarned += conversion.amount;
                linkvertiseStats.allTimeLinks += 1;

                // Check if this is today's conversion
                const today = new Date().toDateString();
                if (linkvertiseStats.lastClaimDate === today) {
                    linkvertiseStats.todayEarned += conversion.amount;
                    linkvertiseStats.todayLinks += 1;
                } else {
                    linkvertiseStats.todayEarned = conversion.amount;
                    linkvertiseStats.todayLinks = 1;
                    linkvertiseStats.lastClaimDate = today;
                }

                await db.set(
                    `linkvertise_stats-${userEmail}`,
                    linkvertiseStats,
                );

                // Add coins to user
                const currentCoins =
                    parseInt(await db.get(`coins-${userEmail}`)) || 0;
                await db.set(
                    `coins-${userEmail}`,
                    currentCoins + conversion.amount,
                );
            }
        }

        res.json({
            success: true,
            message: `Processed ${mockApiResponse.conversions.length} Linkvertise conversions`,
        });
    } catch (error) {
        console.error("Linkvertise sync error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
