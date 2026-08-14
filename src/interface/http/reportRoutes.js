import express from 'express';
import { buildReport } from '../../application/buildReport.js';

export function createReportRoutes(cache) {
    const router = express.Router();

    // GET /reports/weekly — the digest, exactly as the email sends it.
    //
    // The console renders this payload, so what is on screen and what lands in
    // an inbox cannot drift apart.
    router.get('/weekly', async (req, res) => {
        const windowDays = parseInt(req.query.windowDays, 10);

        const report = await buildReport(cache, {
            windowDays: Number.isNaN(windowDays) ? undefined : windowDays,
        });

        if (!report) {
            return res.json({
                report: null,
                reason: 'Nothing open, nothing new and nothing behind this period',
            });
        }

        res.json({ report });
    });

    return router;
}
