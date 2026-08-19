import { describe, test, expect } from '@jest/globals';
import {
    generateDependencyReport,
    dependencyState,
} from '#app/application/dependencyReport.js';

/**
 * The dependency and technology report.
 *
 * The generator is pure, so every count here is checked against literal rows
 * rather than a seeded database. The case that matters most is the boring one:
 * a dependency nobody has compared with a registry must never be counted as up
 * to date, because that single fold turns the whole page into a claim nobody
 * verified.
 */

const NOW = '2026-08-19T12:00:00Z';
const CHECKED = '2026-08-19T09:00:00Z';

function dep(overrides = {}) {
    return {
        repository_id: 1,
        repository_name: 'api',
        repository_url: 'https://github.com/acme/api',
        ecosystem: 'NPM',
        name: 'lodash',
        version: '^4.17.0',
        manifest_file: 'package.json',
        latest_version: '4.17.21',
        latest_checked_at: CHECKED,
        latest_error: null,
        ...overrides,
    };
}

function repo(overrides = {}) {
    return {
        id: 1,
        name: 'api',
        url: 'https://github.com/acme/api',
        primary_language: 'TypeScript',
        languages: { TypeScript: 8000, CSS: 2000 },
        topics: ['backend'],
        last_scanned_at: '2026-08-18T10:00:00Z',
        enabled: true,
        archived: false,
        ...overrides,
    };
}

function report(dependencies, repositories = [repo()], options = {}) {
    return generateDependencyReport({ repositories, dependencies }, { now: NOW, ...options });
}

describe('the four states', () => {
    test('a constraint that already allows the newest release is current', () => {
        expect(dependencyState(dep()).state).toBe('current');
    });

    test('a constraint the newest release does not satisfy is behind, with the gap', () => {
        const state = dependencyState(dep({ version: '4.17.11' }));
        expect(state.state).toBe('behind');
        expect(state.gap).toBe('patch');
    });

    test('a major gap is reported as major', () => {
        expect(dependencyState(dep({ version: '3.10.1' })).gap).toBe('major');
    });

    test('a pin that cannot be compared is unknown, with a reason', () => {
        const state = dependencyState(dep({ version: 'sha256:9f2a3c4d5e6f7a8b' }));
        expect(state.state).toBe('unknown');
        expect(state.reason).toMatch(/digest|commit|interval/);
    });

    test('a lookup that failed is unknown, and keeps what the registry said', () => {
        const state = dependencyState(
            dep({ latest_version: null, latest_error: 'registry answered 404' })
        );
        expect(state.state).toBe('unknown');
        expect(state.reason).toBe('registry answered 404');
    });

    test('a dependency nobody has looked up is unchecked, not current', () => {
        const state = dependencyState(dep({ latest_version: null, latest_checked_at: null }));
        expect(state.state).toBe('unchecked');
    });

    test('unchecked stays out of current even when a latest version is stored', () => {
        // A row can carry a version from a previous schema or an interrupted
        // write; no timestamp means no answer this run.
        const state = dependencyState(dep({ latest_checked_at: null }));
        expect(state.state).toBe('unchecked');
    });
});

describe('the counts', () => {
    const rows = [
        dep({ name: 'lodash', version: '4.17.11' }), // behind, patch
        dep({ name: 'express', version: '^4.18.0', latest_version: '4.18.2' }), // current
        dep({ name: 'react', version: '17.0.2', latest_version: '18.3.1' }), // behind, major
        dep({ name: 'left-pad', latest_version: null, latest_checked_at: null }), // unchecked
        dep({ name: 'nginx', ecosystem: 'DOCKER', version: 'sha256:abc123def456', manifest_file: 'Dockerfile' }), // unknown
    ];

    const result = report(rows);

    test('every row lands in exactly one state', () => {
        expect(result.dependencies.byState).toEqual({
            current: 1,
            behind: 2,
            unknown: 1,
            unchecked: 1,
        });

        const total = Object.values(result.dependencies.byState).reduce((a, b) => a + b, 0);
        expect(total).toBe(result.dependencies.total);
    });

    test('gaps are counted per severity', () => {
        expect(result.updates.byGap).toEqual({ major: 1, minor: 0, patch: 1, other: 0 });
    });

    test('behind matches the state count, so no header can disagree with its rows', () => {
        expect(result.updates.behind).toBe(result.dependencies.byState.behind);
        expect(result.updates.packages.count).toBe(2);
    });

    test('distinct packages, manifests and ecosystems are counted', () => {
        expect(result.dependencies.packages).toBe(5);
        expect(result.dependencies.manifests).toBe(2);
        expect(result.dependencies.ecosystems).toBe(2);
    });

    test('the same package spelled two ways is one package', () => {
        const result = report([dep({ name: 'Lodash' }), dep({ name: 'lodash', manifest_file: 'web/package.json' })]);
        expect(result.dependencies.packages).toBe(1);
        expect(result.dependencies.manifests).toBe(2);
    });
});

describe('what to upgrade', () => {
    test('a package behind in several repositories is one row, ordered by reach', () => {
        const rows = [
            dep({ repository_id: 1, name: 'lodash', version: '4.17.11' }),
            dep({ repository_id: 2, repository_name: 'web', name: 'lodash', version: '3.10.1' }),
            dep({ repository_id: 3, repository_name: 'jobs', name: 'lodash', version: '4.17.15' }),
            dep({ repository_id: 1, name: 'react', version: '17.0.2', latest_version: '18.3.1' }),
        ];

        const result = report(rows, [
            repo({ id: 1 }),
            repo({ id: 2, name: 'web' }),
            repo({ id: 3, name: 'jobs' }),
        ]);

        const [first, second] = result.updates.packages.items;

        expect(first.name).toBe('lodash');
        expect(first.repositories).toBe(3);
        // The widest gap present, not the last one read: a major somewhere in the
        // fleet is what makes the upgrade a piece of work.
        expect(first.worstGap).toBe('major');
        expect(first.declared).toEqual(['4.17.11', '3.10.1', '4.17.15']);

        expect(second.name).toBe('react');
        expect(second.repositories).toBe(1);
    });

    test('repositories are ranked by how much of them is behind', () => {
        const rows = [
            dep({ repository_id: 1, name: 'lodash', version: '4.17.11' }),
            dep({ repository_id: 2, repository_name: 'web', name: 'lodash', version: '4.17.11' }),
            dep({ repository_id: 2, repository_name: 'web', name: 'react', version: '17.0.2', latest_version: '18.3.1' }),
        ];

        const result = report(rows, [repo({ id: 1 }), repo({ id: 2, name: 'web' })]);

        expect(result.updates.repositories.items.map(entry => entry.name)).toEqual(['web', 'api']);
        expect(result.updates.repositories.items[0].behind).toBe(2);
    });

    test('a repository with nothing behind is absent from the upgrade list but present in the fleet list', () => {
        const result = report([dep()], [repo()]);

        expect(result.updates.repositories.count).toBe(0);
        expect(result.repositories.items).toHaveLength(1);
        expect(result.repositories.items[0].total).toBe(1);
    });

    test('a capped list states the whole count next to what it shows', () => {
        const rows = Array.from({ length: 30 }, (_, index) =>
            dep({ name: `pkg-${index}`, version: '1.0.0', latest_version: '2.0.0' })
        );

        const result = report(rows, [repo()], { limit: 10 });

        expect(result.updates.packages.count).toBe(30);
        expect(result.updates.packages.shown).toBe(10);
        expect(result.updates.packages.items).toHaveLength(10);
    });
});

describe('technologies', () => {
    const repositories = [
        repo({ id: 1, name: 'api', languages: { TypeScript: 8000, CSS: 2000 }, topics: ['backend', 'node'] }),
        repo({ id: 2, name: 'web', languages: { TypeScript: 4000, Swift: 6000 }, topics: ['backend'] }),
    ];

    const rows = [
        dep({ repository_id: 1 }),
        dep({ repository_id: 1, ecosystem: 'DOCKER', name: 'node', manifest_file: 'Dockerfile' }),
        dep({ repository_id: 2, repository_name: 'web', manifest_file: 'web/package.json' }),
    ];

    const result = report(rows, repositories);

    test('languages are summed across repositories, with a share of the total', () => {
        expect(result.technologies.languages).toEqual([
            { name: 'TypeScript', bytes: 12_000, repositories: 2, share: 60 },
            { name: 'Swift', bytes: 6000, repositories: 1, share: 30 },
            { name: 'CSS', bytes: 2000, repositories: 1, share: 10 },
        ]);
        expect(result.technologies.totalBytes).toBe(20_000);
    });

    test('ecosystems carry their own behind and unchecked counts', () => {
        const npm = result.technologies.ecosystems.find(entry => entry.name === 'NPM');
        expect(npm).toEqual({ name: 'NPM', packages: 2, behind: 0, unchecked: 0, repositories: 2 });
    });

    test('topics are counted by repository', () => {
        expect(result.technologies.topics).toEqual([
            { name: 'backend', repositories: 2 },
            { name: 'node', repositories: 1 },
        ]);
    });

    test('manifests are counted by file name rather than by path', () => {
        const packageJson = result.technologies.manifests.find(entry => entry.file === 'package.json');
        expect(packageJson).toEqual({ file: 'package.json', packages: 2, repositories: 2 });
    });

    test('a language breakdown nobody has read is said to be missing, not empty', () => {
        const result = report([dep()], [repo({ languages: null })]);

        expect(result.technologies.languages).toEqual([]);
        expect(result.notes.map(note => note.text).join(' ')).toMatch(/No language breakdown/);
    });
});

describe('coverage, and what the report does not know', () => {
    test('a repository that has never been scanned is named, not counted as clean', () => {
        const result = report([dep()], [repo({ id: 1 }), repo({ id: 2, name: 'legacy', last_scanned_at: null })]);

        expect(result.coverage).toMatchObject({ repositories: 2, scanned: 1, neverScanned: 1 });

        const warning = result.notes.find(note => note.text.includes('never been scanned'));
        expect(warning.level).toBe('warn');
        expect(warning.text).toContain('legacy');
    });

    test('unchecked dependencies are called unknown in the notes, not stale', () => {
        const result = report([dep({ latest_checked_at: null, latest_version: null })]);

        const warning = result.notes.find(note => note.text.includes('never been compared'));
        expect(warning.level).toBe('warn');
        expect(warning.text).toContain('unknown, not up to date');
    });

    test('a pin that cannot be compared is explained rather than hidden', () => {
        const result = report([dep({ version: 'sha256:abc123def456' })]);
        expect(result.notes.some(note => note.text.includes('cannot be compared'))).toBe(true);
    });

    test('an old scan is mentioned with the threshold that made it old', () => {
        const result = report([dep()], [repo({ last_scanned_at: '2026-05-01T10:00:00Z' })]);

        expect(result.coverage.staleScans).toBe(1);
        expect(result.notes.some(note => note.text.includes('last scanned over 30 days ago'))).toBe(true);
    });

    test('a registry answer older than a week dates the verdict it produced', () => {
        const result = report([dep({ version: '4.17.11', latest_checked_at: '2026-08-01T09:00:00Z' })]);
        expect(result.notes.some(note => note.text.includes('18 days old'))).toBe(true);
    });

    test('freshness is bracketed by the oldest and newest answer', () => {
        const result = report([
            dep({ latest_checked_at: '2026-08-10T09:00:00Z' }),
            dep({ name: 'express', latest_checked_at: '2026-08-18T09:00:00Z' }),
            dep({ name: 'left-pad', latest_checked_at: null, latest_version: null }),
        ]);

        expect(result.dependencies.checkedAt).toEqual({
            oldest: '2026-08-10T09:00:00.000Z',
            newest: '2026-08-18T09:00:00.000Z',
        });
    });

    test('nothing tracked reports as nothing tracked', () => {
        const result = report([], []);

        expect(result.dependencies.total).toBe(0);
        expect(result.updates.behind).toBe(0);
        expect(result.notes[0].text).toContain('No repository is being tracked');
    });
});

describe('scope', () => {
    test('the fleet report names no repository', () => {
        expect(report([dep()]).scope).toEqual({ kind: 'fleet', repository: null });
    });

    test('a scoped report names the one it covers', () => {
        const result = report([dep()], [repo()], { scope: 'repository' });

        expect(result.scope.kind).toBe('repository');
        expect(result.scope.repository).toEqual({
            id: 1,
            name: 'api',
            url: 'https://github.com/acme/api',
        });
    });

    test('a dependency whose repository is outside the covered set is still counted', () => {
        // Disabled repositories are excluded from the fleet query but their rows
        // can arrive from a scoped one; dropping them would lose the count.
        const result = report([dep({ repository_id: 9, repository_name: 'orphan' })], []);

        expect(result.dependencies.total).toBe(1);
        expect(result.repositories.items[0].name).toBe('orphan');
        expect(result.repositories.items[0].lastScannedAt).toBeNull();
    });
});
