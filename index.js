const express = require("express");
const session = require("express-session");
const fs = require("fs");
const ascii = fs.readFileSync("./function/ascii.txt", "utf8");
const passport = require("passport");
const ejs = require("ejs");
const path = require("path");
const CatLoggr = require("cat-loggr");
const axios = require("axios");
const ipaddr = require("ipaddr.js");
const requestIp = require("request-ip");
const bodyParser = require("body-parser"); // Import body-parser

require("dotenv").config();


const app = express();
const expressWs = require("express-ws")(app);

const updateJsonUrl = "https://discord.gg/98vKKDTNx8";

const { db } = require("./function/db");

const log = new CatLoggr();

const apiINFO = require("./api/apiINFO");
const apiUSERCOINS = require("./api/apiUSERCOINS");
const apiUSERINFO = require("./api/apiUSERINFO");
const apiNODES = require("./api/apiNODES");
const apiADDCOINS = require("./api/apiADDCOINS");
const apiIMAGES = require("./api/apiIMAGES");

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
        color: 3066993,
        thumbnail: {
            url:
                process.env.EMBED_THUMBNAIL_URL ||
                "https://example.com/default-thumbnail.png",
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
require("./function/console");
require("./function/skyport");

async function checkVersion() {
    try {
        const response = await axios.get(updateJsonUrl);
        const latestVersion = response.data.dash_latest;
        const currentVersion = process.env.VERSION;

        if (currentVersion && currentVersion === latestVersion) {
        } else {
            log.info(` your useing Latest version v3.0`);
        }
    } catch (error) {
        log.error(`Failed to check the latest version: ${error.message}`);
    }
}

const currentVersion = process.env.VERSION;

console.log(`${ascii}\n                          version v${currentVersion}\n`);

checkVersion().then(() => {});

const init = async () => {
    if (process.env.ADMIN_USERS) {
        const admins = process.env.ADMIN_USERS.split(",");
        admins.forEach((admin) => db.set(`admin-${admin}`, true));
    } else {
        console.warn("No admin users defined. Skipping admin user creation.");
    }

    app.set("view engine", "ejs");
    app.set("views", path.join(__dirname, "/resources"));

    app.use(
        session({
            secret: process.env.SESSION_SECRET || "default_secret",
            resave: false,
            saveUninitialized: true,
        }),
    );

    app.use(passport.initialize());
    app.use(passport.session());

    app.use(requestIp.mw());

    app.use(bodyParser.json());

    app.use(bodyParser.urlencoded({ extended: true }));

    app.use(async (req, res, next) => {
        const ipAddress = req.clientIp;

        if (!ipaddr.isValid(ipAddress)) {
            console.error(`Invalid IP Address: ${ipAddress}`);
            return res.status(400).json("Invalid IP address format.");
        }

        const userIp = ipaddr.process(ipAddress).toString();
        const proxycheckKey = process.env.PROXYCHECK_KEY;

        try {
            const proxyResponse = await axios.get(
                `http://proxycheck.io/v2/${userIp}?key=${proxycheckKey}`,
            );
            const proxyData = proxyResponse.data;

            if (proxyData[userIp] && proxyData[userIp].proxy === "yes") {
                return res
                    .status(403)
                    .json(
                        "Proxy/VPN detected. Please turn it off to continue.",
                    );
            }
        } catch (error) {
            console.error("Error checking proxy:", error);
            return res.status(500).json("Error checking proxy.");
        }

        // Pass APP_LOGO to every EJS template
        res.locals.app = {
            logo: process.env.APP_LOGO || "default-logo.png", // Default logo if not set
        };

        next();
    });

    app.use(
        session({
            secret: process.env.SESSION_SECRET || "your-default-secret",
            resave: false,
            saveUninitialized: false,
            cookie: { secure: false },
        }),
    );

    app.use("/api", apiINFO);
    app.use("/api", apiUSERCOINS);
    app.use("/api", apiUSERINFO);
    app.use("/api", apiADDCOINS);
    app.use("/api", apiNODES);
    app.use("/api", apiIMAGES);

    const allRoutes = fs.readdirSync("./app");

    allRoutes.forEach((routeFile) => {
        try {
            const routePath = path.join(__dirname, "app", routeFile);
            const routeModule = require(routePath);

            // Handle both simple router exports and object exports
            const route = routeModule.router || routeModule;

            expressWs.applyTo(route); // Apply WebSocket if needed
            app.use("/", route);

            log.init(`Loaded route: ${routeFile}`);
        } catch (error) {
            log.error(`Error loading route: ${routeFile}`);
            log.error(error.message); // Log the specific error message
        }
    });

    app.use(express.static(path.join(__dirname, "public")));

    app.use((req, res) => {
        res.status(404).render("404");
    });

    app.use((req, res) => {
        res.status(500).render("500");
    });

    app.use((req, res) => {
        res.status(429).send("Too Many Requests");
    });

    const port = process.env.APP_PORT || 3000;
    app.listen(port, async () => {
        const appUrl = process.env.APP_URL || `http://localhost:${port}`;
        log.info(`Draco is listening on port ${port}!`);
        await sendDiscordNotification(
            `✅ ${process.env.APP_NAME} is Booting Up.`,
        );
    });
};

init().catch((err) => {
    log.error("Failed to start the application:", err);
});
