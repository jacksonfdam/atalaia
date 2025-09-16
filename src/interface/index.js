// src/interface/index.js
import express from "express";
import dotenv from "dotenv";
import startScheduler from "../infrastructure/scheduler.js";
import monitorVulns from "../application/monitorVulns.js";

dotenv.config();

const app = express();

// Healthcheck endpoint
app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[atalaia] Server running at http://localhost:${PORT}`);

    // Run scheduler
    startScheduler();

    // Run an immediate first cycle
    monitorVulns();
});