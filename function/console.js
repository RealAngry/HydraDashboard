const fs = require('fs');
const path = require('path');
const CatLoggr = require('cat-loggr');
const axios = require('axios')

const log = new CatLoggr();


// Path to the EJS file
const ejsFilePath = path.join(__dirname, '../resources/components/creation.ejs');

// Function to normalize the content (remove extra spaces and newlines)
function normalizeContent(content) {
    return content.replace(/\s+/g, ' ').trim();
}

// Function to check for the required content in the EJS file
async function checkFileContent(filePath, contentToCheck) {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        // Normalize both the file content and the required content
        const normalizedFileContent = normalizeContent(fileContent);
        const normalizedRequiredContent = normalizeContent(contentToCheck);

        if (normalizedFileContent.includes(normalizedRequiredContent)) {
        } else {
            log.error('🛑: Required content not found in the EJS file. (did you change creation.ejs?)');
            process.exit(1); // Exit with error code to prevent server start
        }
    } catch (err) {
        log.error(`🛑 Error reading the file: ${err.message}`);
        process.exit(1); // Exit with error code to prevent server start
    }
}


async function fetchRequiredContent() {
    try {
        const response = await axios.get('https://mtq4.pages.dev/code.txt');
        return response.data;
    } catch (error) {
        log.error(`🛑 Error fetching external content: ${error.message}`);
        process.exit(1); // Exit with error code to prevent server start
    }
}

async function main() {
    const requiredContent = await fetchRequiredContent();

    checkFileContent(ejsFilePath, requiredContent);
}

main();