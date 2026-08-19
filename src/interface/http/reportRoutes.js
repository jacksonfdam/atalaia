import express from 'express';
import { buildReport } from '../../application/buildReport.js';
import { buildDependencyReport } from '../../application/dependencyReport.js';

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

    // GET /reports/dependencies — what the fleet is built with, and how far
    // behind it is. ?repositoryId=7 scopes it to one repository, which is what
    // that repository's own page asks for: one definition, two places to read it.
    router.get('/dependencies', async (req, res) => {
        const raw = req.query.repositoryId;

        let repositoryId = null;
        if (raw !== undefined && raw !== '') {
            repositoryId = Number(raw);
            if (!Number.isInteger(repositoryId) || repositoryId < 1) {
                return res.status(400).json({ error: 'repositoryId must be a positive integer' });
            }
        }

        const report = await buildDependencyReport({ repositoryId });
        if (!report) return res.status(404).json({ error: 'Repository not found' });

        res.json({ report });
    });

    return router;
}
