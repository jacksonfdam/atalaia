import cron from "node-cron";
import config from "./config.js";
import logger from "./logger.js";
import monitorVulns from "../application/monitorVulns.js";
import { generateWeeklyReport } from "../application/generateWeeklyReport.js";
import { sendWeeklyEmail } from "./notifiers/emailNotifier.js";
import { getAll } from "./cache/sqliteCache.js";

function startScheduler() {
    const pattern = config.cronSchedule || "0 * * * *"; // default = every hour
    logger.info({ cron: pattern }, 'Starting scheduler');

    cron.schedule(pattern, async () => {
        logger.info("Running scheduled monitoring job");
        await monitorVulns();
    });

    // Weekly email report (default: Monday 9 AM)
    const weeklyPattern = process.env.WEEKLY_REPORT_CRON || "0 9 * * 1";
    logger.info({ cron: weeklyPattern }, 'Starting weekly report schedule');

    cron.schedule(weeklyPattern, async () => {
        logger.info("Running weekly report generation");
        const vulns = getAll();
        const report = generateWeeklyReport(vulns);
        await sendWeeklyEmail(report);
    });
}

export default startScheduler;