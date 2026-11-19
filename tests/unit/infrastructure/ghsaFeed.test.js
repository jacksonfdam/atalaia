import { describe, test, expect } from '@jest/globals';

const { affectedPackagesOf } = await import('#app/infrastructure/feeds/ghsaFeed.js');
const { fromGithubEcosystem } = await import('#app/infrastructure/feeds/advisoryEcosystems.js');

/**
 * What the advisory feed keeps of GitHub's per-package version data. It used to
 * keep only the names, which is why a patched dependency could never clear a finding.
 */

describe('affectedPackagesOf', () => {
    test('keeps the range and the patched version, under Atalaia\'s ecosystem names', () => {
        const item = {
            vulnerabilities: [
                {
                    package: { ecosystem: 'pip', name: 'Pillow' },
                    vulnerable_version_range: '< 12.2.0',
                    first_patched_version: '12.2.0',
                },
                {
                    package: { ecosystem: 'rust', name: 'tokio' },
                    vulnerable_version_range: '>= 1.0.0, < 1.2.3',
                    first_patched_version: { identifier: '1.2.3' },
                },
            ],
        };

        expect(affectedPackagesOf(item)).toEqual([
            { source: 'ghsa', ecosystem: 'PIP', name: 'pillow', vulnerableRange: '< 12.2.0', firstPatched: '12.2.0' },
            { source: 'ghsa', ecosystem: 'CARGO', name: 'tokio', vulnerableRange: '>= 1.0.0, < 1.2.3', firstPatched: '1.2.3' },
        ]);
    });

    test('no patched version yet is null, not a guess', () => {
        const item = {
            vulnerabilities: [
                { package: { ecosystem: 'npm', name: 'left-pad' }, vulnerable_version_range: '<= 1.3.0', first_patched_version: null },
            ],
        };

        expect(affectedPackagesOf(item)[0].firstPatched).toBeNull();
    });

    test('skips an ecosystem Atalaia does not scan, and an entry with no range', () => {
        const item = {
            vulnerabilities: [
                { package: { ecosystem: 'other', name: 'thing' }, vulnerable_version_range: '< 1' },
                { package: { ecosystem: 'npm', name: 'no-range' } },
                { package: { ecosystem: 'npm', name: 'kept' }, vulnerable_version_range: '< 2' },
            ],
        };

        expect(affectedPackagesOf(item).map(pkg => pkg.name)).toEqual(['kept']);
    });

    test('an advisory with no vulnerabilities yields nothing', () => {
        expect(affectedPackagesOf({})).toEqual([]);
    });
});

describe('fromGithubEcosystem', () => {
    test.each([['npm', 'NPM'], ['PIP', 'PIP'], ['actions', 'GITHUB_ACTIONS'], ['erlang', 'HEX'], ['other', null]])(
        '%s is %s',
        (name, expected) => {
            expect(fromGithubEcosystem(name)).toBe(expected);
        }
    );
});
