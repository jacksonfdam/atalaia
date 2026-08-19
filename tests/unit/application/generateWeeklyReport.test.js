import { describe, test, expect } from '@jest/globals';
import { generateWeeklyReport, SECTION_LIMIT } from '../../../src/application/generateWeeklyReport.js';

const NOW = '2026-08-13T09:00:00.000Z';

/**
 * Days before NOW, in the exact shape the database returns.
 *
 * Down to the `+00`: without the offset these strings parse as local time, and
 * that is how the report was tested green for months while every real row came
 * back as Invalid Date and counted as new.
 */
function daysAgo(days) {
    return `${new Date(Date.parse(NOW) - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)}+00`;
}

function report(vulns, options = {}) {
    return generateWeeklyReport(vulns, { now: NOW, ...options });
}

/** A row of vulnerabilityRepositoryLinks(). */
function link(cveId, repository, dependency, ecosystem = 'NPM', manifest = 'package.json') {
    return {
        cve_id: cveId,
        repository_id: repository.id,
        repository_name: repository.name,
        repository_url: repository.url,
        dependency,
        ecosystem,
        manifest_file: manifest,
    };
}

const API = { id: 1, name: 'acme/api', url: 'https://github.com/acme/api' };
const WEB = { id: 2, name: 'acme/web', url: 'https://github.com/acme/web' };

describe('the window', () => {
    test('nothing stored at all means no report', () => {
        expect(report([])).toBeNull();
    });

    test('everything resolved means no report', () => {
        expect(
            report([
                { cveId: 'CVE-1', severity: 'HIGH', status: 'RESOLVED' },
                { cveId: 'CVE-2', severity: 'LOW', status: 'RESOLVED' },
            ])
        ).toBeNull();
    });

    test('lists only what was detected inside it, and the backlog alongside', () => {
        const vulns = [
            { cve_id: 'CVE-NEW', severity: 'HIGH', status: 'OPEN', first_seen_at: daysAgo(2) },
            { cve_id: 'CVE-EDGE', severity: 'LOW', status: 'OPEN', first_seen_at: daysAgo(6.9) },
            { cve_id: 'CVE-OLD', severity: 'CRITICAL', status: 'OPEN', first_seen_at: daysAgo(30) },
        ];

        const result = report(vulns);

        expect(result.totalCount).toBe(2);
        expect(result.openTotal).toBe(3);
        expect(result.openBySeverity).toEqual({ CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 1, UNKNOWN: 0 });
    });

    test('honours a custom window', () => {
        const vulns = [{ cve_id: 'CVE-OLD', severity: 'HIGH', status: 'OPEN', first_seen_at: daysAgo(30) }];

        expect(report(vulns).totalCount).toBe(0);
        expect(report(vulns, { windowDays: 60 }).totalCount).toBe(1);
    });

    test('a row with no usable timestamp counts as new rather than vanishing', () => {
        const result = report([
            { cve_id: 'CVE-NO-DATE', severity: 'HIGH', status: 'OPEN' },
            { cve_id: 'CVE-BAD-DATE', severity: 'HIGH', status: 'OPEN', first_seen_at: 'not a date' },
        ]);

        expect(result.totalCount).toBe(2);
    });
});

describe('the three sections', () => {
    const vulns = [
        { cve_id: 'CVE-CODE', severity: 'CRITICAL', status: 'OPEN', description: 'lodash thing' },
        { cve_id: 'CVE-IMAGE', severity: 'HIGH', status: 'OPEN' },
        { cve_id: 'CVE-NOBODY', severity: 'MEDIUM', status: 'OPEN' },
    ];

    const links = [
        link('CVE-CODE', API, 'lodash'),
        link('CVE-IMAGE', API, 'nginx', 'DOCKER', 'Dockerfile'),
    ];

    test('split a CVE by what it actually reaches', () => {
        const result = report(vulns, { links });

        expect(result.affecting.count).toBe(1);
        expect(result.infrastructure.count).toBe(1);
        expect(result.other.count).toBe(1);
    });

    // HELM has been in the infrastructure set since before anything could
    // produce a HELM row. A Helm subchart is infrastructure by the same
    // argument as a container image: it is not application code.
    test('a Helm subchart counts as infrastructure', () => {
        const result = report(
            [...vulns, { cve_id: 'CVE-CHART', severity: 'HIGH', status: 'OPEN' }],
            { links: [...links, link('CVE-CHART', API, 'mariadb', 'HELM', 'Chart.lock')] }
        );

        expect(result.infrastructure.vulnerabilities.map(v => v.cveId).sort()).toEqual([
            'CVE-CHART',
            'CVE-IMAGE',
        ]);
        expect(result.affecting.count).toBe(1);
    });

    test('add up to everything detected in the window', () => {
        const result = report(vulns, { links });

        const sum = result.affecting.count + result.infrastructure.count + result.other.count;
        expect(sum).toBe(result.totalCount);
    });

    test('put a CVE that reaches code in affecting, even when it also reaches an image', () => {
        // Reaching application code is the stronger statement: it must not be
        // filed under "containers only" because it happens to also match one.
        const result = report(vulns, {
            links: [...links, link('CVE-CODE', WEB, 'nginx', 'DOCKER', 'Dockerfile')],
        });

        expect(result.affecting.count).toBe(1);
        expect(result.infrastructure.vulnerabilities.map(v => v.cveId)).toEqual(['CVE-IMAGE']);
    });

    test('cap the two ungrouped sections but still report the full count', () => {
        const many = Array.from({ length: SECTION_LIMIT + 10 }, (_, i) => ({
            cve_id: `CVE-${i}`,
            severity: 'LOW',
            status: 'OPEN',
        }));

        const result = report(many);

        expect(result.other.count).toBe(SECTION_LIMIT + 10);
        expect(result.other.shown).toBe(SECTION_LIMIT);
        expect(result.other.vulnerabilities).toHaveLength(SECTION_LIMIT);
    });
});

describe('agreeing with the console', () => {
    test('reports the standing total beside the window count', () => {
        // The complaint that started this: the digest said one number and the
        // console another. They measure different things — this week versus
        // still open — so the report states both rather than picking one.
        const vulns = [
            { cve_id: 'CVE-NEW', severity: 'HIGH', status: 'OPEN', first_seen_at: daysAgo(1) },
            { cve_id: 'CVE-OLD', severity: 'HIGH', status: 'OPEN', first_seen_at: daysAgo(90) },
        ];
        const links = [link('CVE-NEW', API, 'lodash'), link('CVE-OLD', API, 'lodash')];

        const result = report(vulns, { links });

        expect(result.affecting.count).toBe(1); // detected this week
        expect(result.affecting.openCount).toBe(2); // still open, what the console shows
    });
});

describe('grouping by repository', () => {
    const vulns = [
        { cve_id: 'CVE-A', severity: 'HIGH', cvss_score: 7.5, status: 'OPEN' },
        { cve_id: 'CVE-B', severity: 'CRITICAL', cvss_score: 9.8, status: 'OPEN' },
    ];

    test('lists each repository with the CVEs that reach it', () => {
        const result = report(vulns, {
            links: [link('CVE-A', API, 'lodash'), link('CVE-B', WEB, 'express')],
        });

        expect(result.affecting.repositories.map(r => r.name)).toEqual(['acme/web', 'acme/api']);
        expect(result.affecting.repositories[0].worstSeverity).toBe('CRITICAL');
    });

    test('records every dependency a CVE arrives through, without repeating one', () => {
        const result = report(vulns, {
            links: [
                link('CVE-A', API, 'lodash', 'NPM', 'package.json'),
                link('CVE-A', API, 'lodash', 'NPM', 'ui/package.json'),
                link('CVE-A', API, 'lodash', 'NPM', 'package.json'), // the same row twice
            ],
        });

        const via = result.affecting.repositories[0].vulnerabilities[0].via;
        expect(via).toHaveLength(2);
        expect(via.map(v => v.manifestFile)).toEqual(['package.json', 'ui/package.json']);
    });

    test('orders repositories by how bad their worst finding is', () => {
        const result = report(
            [
                { cve_id: 'CVE-LOW', severity: 'LOW', status: 'OPEN' },
                { cve_id: 'CVE-CRIT', severity: 'CRITICAL', status: 'OPEN' },
            ],
            { links: [link('CVE-LOW', API, 'a'), link('CVE-CRIT', WEB, 'b')] }
        );

        expect(result.affecting.repositories[0].name).toBe('acme/web');
    });

    test('ignores a link to a CVE outside the window', () => {
        const result = report([{ cve_id: 'CVE-OLD', severity: 'HIGH', status: 'OPEN', first_seen_at: daysAgo(30) }], {
            links: [link('CVE-OLD', API, 'lodash')],
        });

        expect(result.affecting.count).toBe(0);
        expect(result.affecting.repositories).toEqual([]);
    });
});

describe('the short explanation', () => {
    test('is the model\'s when there is one', () => {
        const result = report([
            {
                cve_id: 'CVE-1',
                severity: 'HIGH',
                status: 'OPEN',
                client_explanation: 'Someone can read your session cookies.',
                description: 'A very long advisory nobody reads.',
            },
        ]);

        expect(result.other.vulnerabilities[0].explanation).toBe('Someone can read your session cookies.');
    });

    test('falls back to the advisory text, trimmed', () => {
        const description = 'x'.repeat(400);
        const result = report([{ cve_id: 'CVE-1', severity: 'HIGH', status: 'OPEN', description }]);

        const explanation = result.other.vulnerabilities[0].explanation;
        expect(explanation).toHaveLength(280);
        expect(explanation.endsWith('…')).toBe(true);
    });

    test('is null when there is nothing to say', () => {
        const result = report([{ cve_id: 'CVE-1', severity: 'HIGH', status: 'OPEN' }]);
        expect(result.other.vulnerabilities[0].explanation).toBeNull();
    });
});

describe('dependencies behind', () => {
    const dependencies = [
        {
            repository_id: API.id,
            repository_name: API.name,
            repository_url: API.url,
            ecosystem: 'NPM',
            name: 'lodash',
            version: '^4.17.0',
            latest_version: '5.2.1',
            manifest_file: 'package.json',
        },
        {
            repository_id: API.id,
            repository_name: API.name,
            repository_url: API.url,
            ecosystem: 'NPM',
            name: 'express',
            version: '^5.0.0',
            latest_version: '5.0.1',
            manifest_file: 'package.json',
        },
    ];

    test('lists only the ones a registry has actually moved past', () => {
        // ^5.0.0 already admits 5.0.1: current, not behind.
        const result = report([{ cve_id: 'CVE-1', severity: 'LOW', status: 'OPEN' }], { dependencies });

        expect(result.dependencies.count).toBe(1);
        expect(result.dependencies.repositories[0].dependencies[0].name).toBe('lodash');
    });

    test('are enough on their own to produce a report', () => {
        const result = report([], { dependencies });

        expect(result).not.toBeNull();
        expect(result.totalCount).toBe(0);
        expect(result.dependencies.count).toBe(1);
    });
});

describe('a digest scoped to one owner', () => {
    const vulns = [
        { cve_id: 'CVE-A', severity: 'HIGH', status: 'OPEN' },
        { cve_id: 'CVE-B', severity: 'HIGH', status: 'OPEN' },
    ];
    const links = [link('CVE-A', API, 'lodash'), link('CVE-B', WEB, 'express')];

    test('reports only the repositories they subscribe to', () => {
        const result = report(vulns, { links, repositoryIds: [API.id] });

        expect(result.scoped).toBe(true);
        expect(result.affecting.repositories.map(r => r.name)).toEqual(['acme/api']);
        expect(result.affecting.count).toBe(1);
    });

    test('leaves out everything that reaches none of their repositories', () => {
        // CVE-B reaches acme/web, which this owner does not subscribe to; the
        // fleet-wide digest's other two sections are the whole world's noise.
        const result = report(vulns, { links, repositoryIds: [API.id] });

        expect(result.other.count).toBe(0);
        expect(result.infrastructure.count).toBe(0);
    });

    test('says nothing at all when their repositories are quiet', () => {
        const result = report(vulns, { links, repositoryIds: [999] });

        expect(result).toBeNull();
    });
});
