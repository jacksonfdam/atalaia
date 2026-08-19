import { jest } from '@jest/globals';

/**
 * Debian security advisories.
 *
 * The fixture is trimmed from the real DSA and DLA lists. Its shape is unusual
 * enough that a hand-written sample would prove nothing, and two of the cases
 * below are only in it because the real lists have them: an advisory with no CVE
 * reference at all, and a kernel advisory carrying hundreds.
 */

const get = jest.fn();
jest.unstable_mockModule('axios', () => ({ default: { get } }));

const { fetch, parseAdvisoryList } = await import('#app/infrastructure/feeds/debianFeed.js');
const { listFeeds } = await import('#app/infrastructure/feeds/feedRegistry.js');

// Trimmed from data/DSA/list. DSA-6448-1 really has no CVE line.
const DSA_LIST = `[18 Aug 2026] DSA-6450-1 srt - security update
	{CVE-2026-55868 CVE-2026-55869}
	[trixie] - srt 1.5.4-1+deb13u1
[18 Aug 2026] DSA-6448-1 spip - security update
	[trixie] - spip 4.4.20+dfsg-0+deb13u1
[17 Aug 2026] DSA-6447-1 librabbitmq - security update
	{CVE-2026-59986 CVE-2026-61547}
	[trixie] - librabbitmq 0.15.0-1+deb13u2
	NOTE: the fix also lands in trixie-security
[2 Jan 2026] DSA-6100-1 expat - security update
	{CVE-2026-72522}
	[bookworm] - expat 2.5.0-1+deb12u1
`;

// Trimmed from data/DLA/list.
const DLA_LIST = `[19 Aug 2026] DLA-4706-2 ruby-grape - regression update
	[bullseye] - ruby-grape 1.4.0-1+deb11u1
[18 Aug 2026] DLA-4745-1 linux-6.12 - security update
	{CVE-2026-64205 CVE-2026-64280 CVE-2026-55868}
	[bookworm] - linux-6.12 6.12.101-1~deb12u1
`;

beforeEach(() => {
    get.mockReset();
    get.mockImplementation(url =>
        Promise.resolve({ data: url.includes('/DLA/') ? DLA_LIST : DSA_LIST })
    );
});

describe('the registry', () => {
    test('debian is listed, off by default, and says why', async () => {
        const debian = (await listFeeds()).find(feed => feed.name === 'debian');

        expect(debian).toBeDefined();
        expect(debian.defaultEnabled).toBe(false);
        expect(debian.disabledReason).toMatch(/Debian/);
    });
});

describe('parsing a list', () => {
    const advisories = parseAdvisoryList(DSA_LIST);

    test('reads the advisory id, the package and the date', () => {
        expect(advisories[0]).toMatchObject({
            id: 'DSA-6450-1',
            packageName: 'srt',
            published: '2026-08-18T00:00:00Z',
            cveIds: ['CVE-2026-55868', 'CVE-2026-55869'],
        });
    });

    // A single-digit day has no leading zero in the file.
    test('a single-digit day parses', () => {
        expect(advisories.find(a => a.id === 'DSA-6100-1').published).toBe('2026-01-02T00:00:00Z');
    });

    // The indented block also holds the fixed version per suite and sometimes a
    // NOTE; only the braces carry CVEs.
    test('a NOTE line does not become a CVE', () => {
        expect(advisories.find(a => a.id === 'DSA-6447-1').cveIds).toEqual([
            'CVE-2026-59986',
            'CVE-2026-61547',
        ]);
    });

    // One kernel advisory in the real list carries just over three hundred CVEs,
    // which is why the limit exists at all.
    test('the limit counts advisories, and stops early', () => {
        expect(parseAdvisoryList(DSA_LIST, 2).map(a => a.id)).toEqual(['DSA-6450-1', 'DSA-6448-1']);
    });
});

describe('what it returns', () => {
    test('one vulnerability per CVE, not per advisory', async () => {
        const vulns = await fetch();

        // Two lists: DSA contributes 5 CVEs across 3 advisories that have any,
        // DLA contributes 3 — one of which repeats a DSA CVE.
        expect(vulns).toHaveLength(7);
        expect(new Set(vulns.map(v => v.cveId)).size).toBe(7);
    });

    test('the package is the affected technology', async () => {
        const vulns = await fetch();
        const srt = vulns.find(v => v.cveId === 'CVE-2026-55869');

        expect(srt).toMatchObject({
            source: 'debian',
            affectedTechnologies: ['srt'],
            link: 'https://security-tracker.debian.org/tracker/DSA-6450-1',
        });
    });

    // The whole reason this feed reads the advisory lists rather than
    // tracker/data/json: an advisory whose age cannot be established is
    // discarded by the monitoring cycle.
    test('every item carries a publication date', async () => {
        const vulns = await fetch();

        expect(vulns.every(v => v.publishedDate instanceof Date)).toBe(true);
        expect(vulns.find(v => v.cveId === 'CVE-2026-72522').publishedDate.getUTCFullYear()).toBe(2026);
    });

    // An advisory with no CVE reference cannot be deduplicated against the other
    // sources, so it is dropped rather than stored as an orphan.
    test.each(['DSA-6448-1', 'DLA-4706-2'])('%s has no CVE, so it produces nothing', async id => {
        const vulns = await fetch();

        expect(vulns.some(v => v.link.endsWith(id))).toBe(false);
    });

    // The kernel appears in a DSA and a DLA in the same week.
    test('a CVE in both lists is one row, from the list read first', async () => {
        const vulns = await fetch();
        const shared = vulns.filter(v => v.cveId === 'CVE-2026-55868');

        expect(shared).toHaveLength(1);
        expect(shared[0].affectedTechnologies).toEqual(['srt']);
    });

    // The advisory lists state a package and a date, never a severity. The
    // urgency in tracker/data/json is not one either: `unimportant` there means
    // Debian judged the issue not worth a security update, so mapping it onto
    // LOW would turn a decision not to fix into a finding.
    test('severity is unknown rather than guessed', async () => {
        const vulns = await fetch();

        expect([...new Set(vulns.map(v => v.severity))]).toEqual(['UNKNOWN']);
    });

    test('both lists are read', async () => {
        await fetch();

        expect(get.mock.calls.map(([url]) => url.split('/').at(-2))).toEqual(['DSA', 'DLA']);
    });

    test('the per-feed timeout is respected', async () => {
        await fetch();

        expect(get.mock.calls[0][1].timeout).toBeGreaterThan(0);
    });
});

describe('when it goes wrong', () => {
    // A source that answers with zero items is EMPTY, not healthy, and the
    // health check decides that from the empty array.
    test('an empty list is an empty array, not an error', async () => {
        get.mockResolvedValue({ data: '' });

        await expect(fetch()).resolves.toEqual([]);
    });

    // The cycle runs every source through Promise.allSettled, so one failing
    // must never block the others.
    test('a transport failure throws rather than looking like silence', async () => {
        get.mockRejectedValue(new Error('getaddrinfo ENOTFOUND salsa.debian.org'));

        await expect(fetch()).rejects.toThrow(/ENOTFOUND/);
    });

    // A date this feed cannot read has to come back as nothing rather than as
    // today: substituting the current date is how a 2021 advisory reaches a chat
    // marked as new.
    test('an unreadable month is no date rather than today', () => {
        const advisories = parseAdvisoryList('[18 Xxx 2026] DSA-1-1 thing - security update\n\t{CVE-2026-1}\n');

        expect(advisories[0].published).toBeNull();
    });
});
