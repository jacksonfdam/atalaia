import express from 'express';
import { generateWeeklyReport } from '../../application/generateWeeklyReport.js';

export function createReportRoutes(cache) {
    const router = express.Router();

    // GET /reports/weekly — preview the digest without sending any email
    router.get('/weekly', async (_req, res) => {
        const report = generateWeeklyReport(await cache.getAll());
        if (!report) {
            return res.json({
                report: null,
                reason: 'No open or acknowledged vulnerabilities this period',
            });
        }
        res.json({ report });
    });

    return router;
}
