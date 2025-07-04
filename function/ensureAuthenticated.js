const { db } = require('./db');

async function ensureAuthenticated(req, res, next) {
    // Check if user is authenticated
    if (!req.isAuthenticated()) {
        req.session.returnTo = req.originalUrl;
        return res.redirect('/');  // More explicit than just '/'
    }

    try {
        // Check if the user is banned
        const reason = await db.get(`banned-${req.user.email}`);

        if (reason) {
            return res.redirect(`/?err=BANNED&reason=${encodeURIComponent(reason)}`);
        }

        // Additional security checks could be added here
        // For example: check if account is locked, needs 2FA, etc.

        // If all checks pass
        return next();
    } catch (err) {
        console.error('Authentication Middleware Error:', err);

        // Differentiate between database errors and other errors
        if (err.name === 'DatabaseError') {
            return res.status(503).render('errors/database-unavailable');
        }

        // For other errors
        return res.status(500).render('errors/internal-server-error');
    }
}

module.exports = {
    ensureAuthenticated,
    // Could add more middleware functions here
    // ensureAdmin, ensure2FA, etc.
};