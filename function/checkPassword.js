const { db } = require('./db');

/**
 * Retrieves the password for a given email from the database.
 * @param {string} email - The email address to look up.
 * @returns {Promise<string|null>} The password if found, null if not found.
 * @throws {Error} If the email is invalid or database operation fails.
 */
async function checkPassword(email) {
    // Input validation
    if (typeof email !== 'string' || !email.includes('@') || !email.includes('.')) {
        throw new Error('Invalid email format');
    }

    try {
        // Trim and lowercase email for consistency
        const normalizedEmail = email.trim().toLowerCase();

        // Retrieve password from database
        const password = await db.get(`password-${normalizedEmail}`);

        // Return null if password doesn't exist
        if (!password) {
            return null;
        }

        // Return the password if it exists
        return password;
    } catch (error) {
        console.error(`Error retrieving password for ${email}:`, error);

        // Differentiate between "not found" errors and other database errors
        if (error.type === 'NotFoundError') {
            return null;
        }

        // Re-throw other errors with more context
        throw new Error(`Failed to retrieve password: ${error.message}`);
    }
}

module.exports = { checkPassword };