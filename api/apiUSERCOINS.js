const express = require('express');
const Keyv = require('keyv');
require('dotenv').config(); // Load environment variables

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

async function getUserCoins(email) {
    const key = `coins-${email}`;
    return await keyv.get(key);
}

router.get('/application/user/coins', authenticate, async (req, res) => {
    const email = req.query.email;

    if (!email) {
        return res.status(400).json({ error: "Missing email parameter" });
    }

    try {
        const coins = await getUserCoins(email);
        if (coins === undefined) {
            return res.status(404).json({ error: "User not Found in Database" });
        }
        res.json({ email, coins });
    } catch (error) {
        res.status(500).json({ error: "Query execution failed", details: error.message });
    }
});

module.exports = router;
