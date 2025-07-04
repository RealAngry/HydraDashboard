const express = require('express');
const router = express.Router();
const Keyv = require('keyv');
const db = new Keyv('sqlite://storage/database.sqlite'); // Adjust the path accordingly

router.get('/addcoins', async (req, res) => {
    const { email, coins, key } = req.query;

    if (key !== process.env.API_KEY) {
        return res.status(401).json({ error: 'INVALID API KEY' });
    }

    if (!email || !coins) {
        return res.status(400).json({ error: 'INVALIDPARAMS' });
    }

    try {
        let currentCoins = parseInt(await db.get(`coins-${email}`)) || 0;
        let amountParse = currentCoins + parseInt(coins);
        await db.set(`coins-${email}`, amountParse);
        res.status(200).json({ message: 'ADDED COINS', newAmount: amountParse });
    } catch (error) {
        res.status(500).json({ error: 'Failed to Add Coins', details: error.message });
    }
});

module.exports = router;
