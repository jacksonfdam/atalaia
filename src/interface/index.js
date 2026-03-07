// src/interface/index.js
import express from "express";
import dotenv from "dotenv";
import logger from "../infrastructure/logger.js";
import startScheduler from "../infrastructure/scheduler.js";
import monitorVulns from "../application/monitorVulns.js";
import { initializeDatabase } from "../infrastructure/cache/sqliteCache.js";
import * as cache from "../infrastructure/cache/sqliteCache.js";
import { createApiRoutes } from "./http/apiRoutes.js";

dotenv.config();

// Initialize Database (Migrations)
initializeDatabase();

const app = express();
app.use(express.json());

// Healthcheck endpoint
app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

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