import cron from "node-cron";
import config from "./config.js";
import monitorVulns from "../application/monitorVulns.js";

function startScheduler() {
    const pattern = config.cronSchedule || "0 * * * *"; // default = every hour
    console.log(`[scheduler] Starting with cron: ${pattern}`);

    cron.schedule(pattern, async () => {
        console.log("[scheduler] Running scheduled job...");
        await monitorVulns();
    });
}

export default startScheduler;