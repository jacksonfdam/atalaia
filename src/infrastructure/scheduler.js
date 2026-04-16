import cron from "node-cron";
import config from "./config.js";
import logger from "./logger.js";
import monitorVulns from "../application/monitorVulns.js";
import { generateWeeklyReport } from "../application/generateWeeklyReport.js";
import { sendWeeklyEmail } from "./notifiers/emailNotifier.js";
import { getAll } from "./cache/sqliteCache.js";
import { scanAllRepositories } from "../application/scanAllRepositories.js";

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

    // Repository scanning (default: daily 3 AM)
    if (config.repositories?.autoScan && (config.providers || []).length > 0) {
        const scanPattern = config.repositories.scanCron || "0 3 * * *";
        logger.info({ cron: scanPattern }, 'Starting repository scan schedule');

        cron.schedule(scanPattern, async () => {
            logger.info("Running scheduled repository scan");
            try {
                const result = await scanAllRepositories();
                logger.info(result, 'Scheduled repository scan complete');
            } catch (err) {
                logger.error({ err }, 'Scheduled repository scan failed');
            }
        });
    }
}

export default startScheduler;