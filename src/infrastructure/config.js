import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import pino from "pino";

// quiet: dotenv v17 otherwise prints a banner that breaks the structured log stream
//
// Not under test, though. A developer's .env would otherwise decide how the
// suite behaves: leave SLACK_SIGNING_SECRET or SMTP_HOST set in it and tests
// about "the console can still write this" fail on that machine and pass on
// every other. A test declares the environment it needs.
if (process.env.NODE_ENV !== 'test') dotenv.config({ quiet: true });

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

// allow overriding the Slack notification switch from .env
config.slack = config.slack || {};
if (process.env.SLACK_ENABLED !== undefined) {
    config.slack.enabled = process.env.SLACK_ENABLED === "true";
} else {
    config.slack.enabled = config.slack.enabled === true;
}

export default config;