import { jest } from '@jest/globals';

/**
 * What the health report is allowed to say about a source.
 *
 * The row an operator reads to decide whether a source is broken, so the
 * distinction that matters is between a source that answered with nothing and
 * one that was never called at all.
 */

const listFeeds = jest.fn();
jest.unstable_mockModule('#app/infrastructure/feeds/feedRegistry.js', () => ({ listFeeds }));

const { checkFeedHealth, resetFeedHealthCache } = await import('#app/application/checkFeedHealth.js');

/** A registry entry as feedRegistry.bind() hands it over. */
function feed({ name, enabled = true, missing = null, vulns = [], fails = null, disabledReason = null }) {
    return {
        name,
        label: name.toUpperCase(),
        enabled,
        disabledReason,
        unconfiguredReason: jest.fn(async () => missing),
        fetch: jest.fn(async () => {
            if (fails) throw fails;
            return vulns;
        }),
    };
}

const ONE = [{ severity: 'High', cvssScore: 7.5 }];

beforeEach(() => resetFeedHealthCache());

async function report(feeds) {
    listFeeds.mockResolvedValue(feeds);
    const { feeds: rows } = await checkFeedHealth({ force: true });
    return Object.fromEntries(rows.map(row => [row.name, row]));
}

describe('a source that is not set up', () => {
    test('is NOT_CONFIGURED, and says what is missing', async () => {
        const rows = await report([feed({ name: 'opencve', missing: 'No API token.' })]);

        expect(rows.opencve).toMatchObject({
            status: 'NOT_CONFIGURED',
            detail: 'No API token.',
        });
    });

    // Reporting it as EMPTY claimed the source had responded. It had not, and
    // the operator went looking at the source instead of at their own config.
    test('is never called', async () => {
        listFeeds.mockResolvedValue([feed({ name: 'opencve', missing: 'No API token.' })]);
        const { feeds: rows } = await checkFeedHealth({ force: true });

        expect(rows[0].count).toBe(0);
        expect(rows[0].latencyMs).toBe(0);
    });
});

describe('the other outcomes still hold', () => {
    test('a source that answers with rows is OK', async () => {
        const rows = await report([feed({ name: 'cisa', vulns: ONE })]);

        expect(rows.cisa).toMatchObject({ status: 'OK', count: 1, withCvss: 1 });
    });

    test('a configured source that answers with nothing is EMPTY', async () => {
        const rows = await report([feed({ name: 'mitre' })]);

        expect(rows.mitre.status).toBe('EMPTY');
        // The old wording blamed missing credentials for this too, which is
        // now a status of its own.
        expect(rows.mitre.detail).not.toMatch(/credentials/i);
    });

    test('a source that throws is ERROR, carrying its message', async () => {
        const rows = await report([feed({ name: 'nvd', fails: new Error('NVD refused the request (503)') })]);

        expect(rows.nvd).toMatchObject({ status: 'ERROR' });
        expect(rows.nvd.detail).toMatch(/503/);
    });

    test('a source the operator turned off is DISABLED and not called', async () => {
        const off = feed({ name: 'snyk', enabled: false, disabledReason: 'Off on purpose.' });
        await report([off]);

        expect(off.fetch).not.toHaveBeenCalled();
        expect(off.unconfiguredReason).not.toHaveBeenCalled();
    });
});
