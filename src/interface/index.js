// src/interface/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import logger from "../infrastructure/logger.js";
import startScheduler from "../infrastructure/scheduler.js";
import monitorVulns from "../application/monitorVulns.js";
import { initializeDatabase } from "../infrastructure/cache/sqliteCache.js";
import * as cache from "../infrastructure/cache/sqliteCache.js";
import { createApiRoutes } from "./http/apiRoutes.js";
import { requireSlackSignature, createSlackActionHandler } from "./slack/slackActions.js";

dotenv.config();

// Initialize Database (Migrations)
initializeDatabase();

const app = express();

// Security headers
app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
});

// CORS
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000").split(",");
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Capture raw body for Slack signature verification, then parse JSON/urlencoded
app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}));
app.use(express.urlencoded({
    extended: true,
    verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}));

// Healthcheck endpoint
app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Slack interactive actions endpoint (before API routes to avoid API key middleware)
app.post("/api/v1/slack/actions", requireSlackSignature, createSlackActionHandler(cache));

// REST API v1
app.use("/api/v1", createApiRoutes(cache));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Atalaia server running');

    // Run scheduler
    startScheduler();

    // Run an immediate first cycle
    monitorVulns();
});