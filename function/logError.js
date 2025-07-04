const fs = require('fs');

const logError = (message, error = '') => {
  const errorMessage = `[ERROR] ${message}${error ? `: ${error.message || error}` : ''}\n`;
  fs.appendFile(process.env.LOGS_ERROR_PATH, errorMessage, (err) => {
    if (err) console.error(`Failed to save log: ${err}`);
  });
  console.error(errorMessage);
};

module.exports = { logError };
