import cron from "node-cron";
import config from "./config.js";
import logger from "./logger.js";
import monitorVulns from "../application/monitorVulns.js";

function startScheduler() {
    const pattern = config.cronSchedule || "0 * * * *"; // default = every hour
    logger.info({ cron: pattern }, 'Starting scheduler');

    cron.schedule(pattern, async () => {
        logger.info("Running scheduled monitoring job");
        await monitorVulns();
    });
}

export default startScheduler;