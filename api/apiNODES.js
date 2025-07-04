const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

router.use('/application/nodes', (req, res, next) => {
    const apiKey = req.query.key;
    if (apiKey !== process.env.API_KEY) {
        return res.status(403).json({ error: 'Forbidden: Invalid API Key' });
    }
    next();
});

router.get('/application/nodes', (req, res) => {
    const filePath = path.join(__dirname, '../storage/nodes.json');

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Internal Server Error' });
        }

        try {
            const jsonData = JSON.parse(data);

            const filteredData = jsonData.map(item => ({
                name: item.name,
                processor: item.processor,
                id: item.id,
                ram: item.ram,
                disk: item.disk
            }));

            res.json(filteredData);
        } catch (parseError) {
            return res.status(500).json({ error: 'Error parsing JSON data' });
        }
    });
});

module.exports = router;
