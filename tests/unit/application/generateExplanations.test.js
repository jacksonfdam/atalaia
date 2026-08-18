import { jest } from '@jest/globals';

/**
 * The batch text job.
 *
 * The two writers are mocked: what is under test is the loop around them —
 * which CVEs it skips, what it counts, and that one failure does not take the
 * rest of the batch with it.
 */

const explainVulnerability = jest.fn(async () => ({ explanation: 'because' }));
const mitigateVulnerability = jest.fn(async () => ({ mitigation: 'upgrade it' }));

jest.unstable_mockModule('../../../src/application/explainVulnerability.js', () => ({
    explainVulnerability,
}));
jest.unstable_mockModule('../../../src/application/mitigateVulnerability.js', () => ({
    mitigateVulnerability,
    correlateForRow: jest.fn(),
}));

const { generateExplanations } = await import('../../../src/application/generateExplanations.js');

function cacheOf(rows) {
    const store = new Map(rows.map(row => [row.cve_id, row]));
    return { get: async cveId => store.get(cveId) ?? null, update: jest.fn() };
}

beforeEach(() => {
    explainVulnerability.mockClear();
    mitigateVulnerability.mockClear();
});

describe('generateExplanations', () => {
    test('writes an explanation for every CVE without one', async () => {
        const cache = cacheOf([
            { cve_id: 'CVE-1', client_explanation: null },
            { cve_id: 'CVE-2', client_explanation: null },
        ]);

        const progress = await generateExplanations({ cveIds: ['CVE-1', 'CVE-2'], cache });

        expect(progress.written).toBe(2);
        expect(progress.skipped).toBe(0);
        expect(progress.failed).toBe(0);
        expect(explainVulnerability).toHaveBeenCalledTimes(2);
    });

    test('leaves text that is already there alone', async () => {
        const cache = cacheOf([
            { cve_id: 'CVE-1', client_explanation: 'written last month' },
            { cve_id: 'CVE-2', client_explanation: null },
        ]);

        const progress = await generateExplanations({ cveIds: ['CVE-1', 'CVE-2'], cache });

        expect(progress.written).toBe(1);
        expect(progress.skipped).toBe(1);
        expect(explainVulnerability).toHaveBeenCalledTimes(1);
    });

    test('force rewrites it', async () => {
        const cache = cacheOf([{ cve_id: 'CVE-1', client_explanation: 'written last month' }]);

        const progress = await generateExplanations({ cveIds: ['CVE-1'], cache, force: true });

        expect(progress.written).toBe(1);
        expect(progress.skipped).toBe(0);
    });

    test('the mitigation kind uses the other writer', async () => {
        const cache = cacheOf([{ cve_id: 'CVE-1', client_explanation: null }]);

        await generateExplanations({ cveIds: ['CVE-1'], kind: 'mitigation', cache });

        expect(mitigateVulnerability).toHaveBeenCalledTimes(1);
        expect(explainVulnerability).not.toHaveBeenCalled();
    });

    test('one CVE the model chokes on does not end the batch', async () => {
        const cache = cacheOf([
            { cve_id: 'CVE-1', client_explanation: null },
            { cve_id: 'CVE-2', client_explanation: null },
        ]);
        explainVulnerability.mockRejectedValueOnce(new Error('model answered with nothing'));

        const progress = await generateExplanations({ cveIds: ['CVE-1', 'CVE-2'], cache });

        expect(progress.failed).toBe(1);
        expect(progress.written).toBe(1);
        expect(progress.done).toBe(2);
        expect(progress.errors[0]).toMatchObject({ cveId: 'CVE-1' });
    });

    test('a CVE that is not stored is a failure with a reason, not a crash', async () => {
        const cache = cacheOf([]);

        const progress = await generateExplanations({ cveIds: ['CVE-NOPE'], cache });

        expect(progress.failed).toBe(1);
        expect(progress.errors[0].error).toMatch(/not found/);
    });

    test('progress is reported as it goes, not only at the end', async () => {
        const cache = cacheOf([
            { cve_id: 'CVE-1', client_explanation: null },
            { cve_id: 'CVE-2', client_explanation: null },
        ]);
        const seen = [];

        await generateExplanations({
            cveIds: ['CVE-1', 'CVE-2'],
            cache,
            onProgress: p => seen.push(p.done),
        });

        // Something in the middle, or the console has nothing to show until the
        // batch is over — which is the same as no progress at all.
        expect(seen).toContain(1);
        expect(seen.at(-1)).toBe(2);
    });

    // A bad model configuration fails every row; twenty of those is enough to
    // see the pattern, and the flag is what stops the rest going missing quietly.
    test('the error list is capped, and says so', async () => {
        const cveIds = Array.from({ length: 25 }, (_unused, index) => `CVE-${index}`);
        const cache = cacheOf(cveIds.map(cve_id => ({ cve_id, client_explanation: null })));
        explainVulnerability.mockRejectedValue(new Error('no model configured'));

        const progress = await generateExplanations({ cveIds, cache });

        expect(progress.failed).toBe(25);
        expect(progress.errors).toHaveLength(20);
        expect(progress.errorsTruncated).toBe(true);
    });
});
