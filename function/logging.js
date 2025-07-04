// logger.js
const { color } = require('./colors');

function log(type, message) {
  let selectedColor;
  
  // Select color based on log type
  switch (type) {
    case 'warn':
      selectedColor = color.brightYellow;  // Yellow for warnings
      break;
    case 'error':
      selectedColor = color.brightRed;     // Red for errors
      break;
    case 'init':
      selectedColor = color.brightBlue;    // Blue for initialization
      break;
    case 'log':
      selectedColor = color.brightGreen;   // Green for regular logs
      break;
    default:
      selectedColor = color.brightGreen;   // Default to green
  }

  // Format the message with color, bold log type, and italic message
  const formattedMessage = `${selectedColor}${color.bold}${type}${color.reset} | ${color.italic}${color.brightBlack}${message}${color.reset}`;
  
  // Log the formatted message to the console
  console.log(formattedMessage);
}

// Exporting the logging functions for each type
module.exports = {
  warn: (message) => log('warn', message),
  error: (message) => log('error', message),
  init: (message) => log('init', message),
  log: (message) => log('log', message)
};
