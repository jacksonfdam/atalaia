import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import pino from "pino";

dotenv.config();

const configPath = path.resolve("config.json");
let rawConfig = {};
try {
    const file = fs.readFileSync(configPath, "utf-8");
    rawConfig = JSON.parse(file || "{}");
} catch (err) {
    const configLogger = pino({ level: process.env.LOG_LEVEL || 'info' });
    configLogger.error({ err }, 'Failed to load config.json');
    rawConfig = {};
}

function substituteEnv(obj) {
    if (typeof obj === "string") {
        return obj.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || "");
    }

    if (Array.isArray(obj)) {
        return obj.map(substituteEnv);
    }

    if (typeof obj === "object" && obj !== null) {
        return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [k, substituteEnv(v)])
        );
    }

    return obj;
}

const config = substituteEnv(rawConfig);

// allow overriding cron from .env
if (process.env.CRON_SCHEDULE) {
    config.cronSchedule = process.env.CRON_SCHEDULE;
}

export default config;