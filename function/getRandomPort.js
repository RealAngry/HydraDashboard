function getRandomPort(ports) {
    const keys = Object.keys(ports);
    return keys[Math.floor(Math.random() * keys.length)];
}

module.exports = { getRandomPort };