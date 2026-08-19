import { describe, test, expect } from '@jest/globals';
import {
    reconcileDependencies,
    resolvedManifests,
} from '#app/application/reconcileDependencies.js';

/**
 * What happens when a manifest and a lockfile name the same package.
 *
 * The unique key on a dependency includes the manifest file, so without this
 * pass a repository with both stores lodash twice and every count doubles.
 */

/** A parsed row as the scanner has it: manifestFile is the full path. */
function dep(ecosystem, name, version, manifestFile) {
    return { ecosystem, name, version, manifestFile };
}

const names = deps => deps.map(d => `${d.name}@${d.version} (${d.manifestFile})`).sort();

describe('one directory', () => {
    const deps = [
        dep('NPM', 'lodash', '^4.17.0', 'package.json'),
        dep('NPM', 'lodash', '4.17.21', 'package-lock.json'),
    ];

    test('the lockfile row wins and the manifest row goes', () => {
        const kept = reconcileDependencies(deps, new Set(['package-lock.json']));

        expect(kept).toHaveLength(1);
        expect(kept[0]).toMatchObject({ version: '4.17.21', manifestFile: 'package-lock.json' });
    });

    // The manifest is still the only record a repository without a committed
    // lockfile has, so winning must not mean being ignored.
    test('a package only the manifest names survives', () => {
        const kept = reconcileDependencies(
            [...deps, dep('NPM', 'express', '^4.18.0', 'package.json')],
            new Set(['package-lock.json'])
        );

        expect(names(kept)).toEqual([
            'express@^4.18.0 (package.json)',
            'lodash@4.17.21 (package-lock.json)',
        ]);
    });

    // An out-of-date lockfile that has not caught up with a newly added
    // dependency must not make that dependency disappear.
    test('a lockfile that does not list the package does not speak for it', () => {
        const kept = reconcileDependencies(
            [dep('NPM', 'express', '^4.18.0', 'package.json'), dep('NPM', 'lodash', '4.17.21', 'package-lock.json')],
            new Set(['package-lock.json'])
        );

        expect(kept).toHaveLength(2);
    });
});

describe('a monorepo', () => {
    // Two applications, each with its own lockfile, each really depending on
    // lodash. Collapsing them into one row would lose an application.
    test('the same package under two lockfiles stays two rows', () => {
        const deps = [
            dep('NPM', 'lodash', '4.17.21', 'apps/a/package-lock.json'),
            dep('NPM', 'lodash', '4.17.15', 'apps/b/package-lock.json'),
        ];

        const kept = reconcileDependencies(deps, new Set(deps.map(d => d.manifestFile)));

        expect(kept).toHaveLength(2);
    });

    test("a lockfile does not speak for a sibling directory's manifest", () => {
        const deps = [
            dep('NPM', 'lodash', '4.17.21', 'apps/a/package-lock.json'),
            dep('NPM', 'lodash', '^4.17.0', 'apps/b/package.json'),
        ];

        const kept = reconcileDependencies(deps, new Set(['apps/a/package-lock.json']));

        expect(names(kept)).toEqual([
            'lodash@4.17.21 (apps/a/package-lock.json)',
            'lodash@^4.17.0 (apps/b/package.json)',
        ]);
    });

    // A workspace resolves every package into one lockfile at the root, and
    // that lockfile is the answer for all of them.
    test('a root lockfile supersedes a workspace package manifest', () => {
        const deps = [
            dep('NPM', 'lodash', '4.17.21', 'pnpm-lock.yaml'),
            dep('NPM', 'lodash', '^4.17.0', 'packages/ui/package.json'),
        ];

        const kept = reconcileDependencies(deps, new Set(['pnpm-lock.yaml']));

        expect(kept).toHaveLength(1);
        expect(kept[0].manifestFile).toBe('pnpm-lock.yaml');
    });
});

describe('what is not the same package', () => {
    // lodash on npm and a lodash gem are unrelated, and a CVE against one says
    // nothing about the other.
    test('two ecosystems naming the same package stay two rows', () => {
        const deps = [
            dep('NPM', 'lodash', '4.17.21', 'package-lock.json'),
            dep('RUBYGEMS', 'lodash', '~> 1.0', 'Gemfile'),
        ];

        const kept = reconcileDependencies(deps, new Set(['package-lock.json']));

        expect(kept).toHaveLength(2);
    });
});

describe('nothing to reconcile', () => {
    test('no lockfile in the repository leaves every row alone', () => {
        const deps = [dep('NPM', 'lodash', '^4.17.0', 'package.json')];

        expect(reconcileDependencies(deps, new Set())).toBe(deps);
        expect(reconcileDependencies(deps, undefined)).toBe(deps);
    });

    test('a lockfile that parsed to nothing leaves every row alone', () => {
        const deps = [dep('NPM', 'lodash', '^4.17.0', 'package.json')];

        expect(reconcileDependencies(deps, new Set(['package-lock.json']))).toBe(deps);
    });
});

describe('resolvedManifests', () => {
    test('picks out the parsers that state a resolved version', () => {
        const jobs = [
            { filePath: 'ios/Podfile.lock', parser: { resolvesVersions: true } },
            { filePath: 'package.json', parser: {} },
            { filePath: 'Package.resolved', parser: { resolvesVersions: true } },
        ];

        expect(resolvedManifests(jobs)).toEqual(new Set(['ios/Podfile.lock', 'Package.resolved']));
    });

    // The flag is read off the parser, never off a list of filenames kept by
    // the scanner, so a new lockfile parser cannot be forgotten in one place.
    test('a parser that says nothing reads constraints', () => {
        expect(resolvedManifests([{ filePath: 'Gemfile', parser: {} }]).size).toBe(0);
    });
});

describe('the two lockfile parsers that already exist', () => {
    test.each([
        ['swiftParser', 'Package.resolved'],
        ['cocoapodsParser', 'Podfile.lock'],
    ])('%s declares itself resolved', async (name, file) => {
        const parser = await import(`#app/infrastructure/parsers/${name}.js`);

        expect(parser.resolvesVersions).toBe(true);
        expect(parser.manifestFiles).toContain(file);
    });
});
