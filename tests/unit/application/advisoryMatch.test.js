import { describe, test, expect } from '@jest/globals';

const { evaluateMatch, parseAdvisoryRange } = await import('#app/application/advisoryMatch.js');

/**
 * The verdict a stored dependency version gets against an advisory's range.
 *
 * The first block is the real case that prompted this: Pillow's FlashPix
 * overflow (< 12.2.0), against what two repositories declared.
 */

const pillow = [{ ecosystem: 'PIP', name: 'pillow', vulnerableRange: '< 12.2.0', firstPatched: '12.2.0' }];
const dep = (version, extra = {}) => ({ ecosystem: 'PIP', name: 'Pillow', version, ...extra });

describe('parseAdvisoryRange', () => {
    test.each([
        ['< 12.2.0', '<12.2.0'],
        ['>= 1.0, < 1.2.3', '>=1.0.0 <1.2.3'],
        ['= 2.0.1', '2.0.1'],
        ['<= 4.17', '<=4.17.0'],
    ])('%s reads as %s', (text, expected) => {
        expect(parseAdvisoryRange(text)).toBe(expected);
    });

    test.each([[''], ['~> 1.2'], ['< 1.2rc1'], ['>= 1.2.3.4']])('%j is not something it can read', text => {
        expect(parseAdvisoryRange(text)).toBeNull();
    });
});

describe('a pinned version', () => {
    test.each([
        ['==11.1.0', 'affected'],
        ['==13.0.0', 'unaffected'],
        ['12.1.9', 'affected'],
        ['12.2.0', 'unaffected'],
    ])('%s is %s', (version, verdict) => {
        expect(evaluateMatch(dep(version), pillow).verdict).toBe(verdict);
    });

    test('names the patched version', () => {
        expect(evaluateMatch(dep('==11.1.0'), pillow).patchedIn).toBe('12.2.0');
    });
});

describe('a constraint', () => {
    test('that cannot reach an affected version is unaffected', () => {
        expect(evaluateMatch(dep('>=13.0.0'), pillow).verdict).toBe('unaffected');
    });

    test('that allows only affected versions is affected', () => {
        expect(evaluateMatch(dep('<12.0.0'), pillow).verdict).toBe('affected');
    });

    test('that allows both is unverified, and says why', () => {
        const result = evaluateMatch(
            { ecosystem: 'NPM', name: 'lodash', version: '^4.17.0' },
            [{ ecosystem: 'NPM', name: 'lodash', vulnerableRange: '< 4.17.21', firstPatched: '4.17.21' }]
        );

        expect(result.verdict).toBe('unverified');
        expect(result.reason).toMatch(/allows both/);
    });

    test('with commas is read as a range, not as its first version', () => {
        expect(evaluateMatch(dep('>=11.0,<12.0'), pillow).verdict).toBe('affected');
        expect(evaluateMatch(dep('>=13.0,<14.0'), pillow).verdict).toBe('unaffected');
    });

    test.each([['!=12.0.0'], ['>=1.0,!=1.5'], ['latest']])('%s is unverified, not guessed', version => {
        expect(evaluateMatch(dep(version), pillow).verdict).toBe('unverified');
    });
});

describe('every copy in a lockfile counts', () => {
    const lodash = [{ ecosystem: 'NPM', name: 'lodash', vulnerableRange: '>= 5.0.0, < 5.1.0' }];

    test('a patched low copy beside a vulnerable high one is affected', () => {
        const result = evaluateMatch(
            { ecosystem: 'NPM', name: 'lodash', version: '4.17.21', versions: ['4.17.21', '5.0.0'] },
            lodash
        );

        expect(result.verdict).toBe('affected');
    });

    test('all copies patched is unaffected', () => {
        const result = evaluateMatch(
            { ecosystem: 'NPM', name: 'lodash', version: '4.17.21', versions: ['4.17.21', '5.1.0'] },
            lodash
        );

        expect(result.verdict).toBe('unaffected');
    });
});

describe('what it will not claim', () => {
    test('no range stored is unverified', () => {
        expect(evaluateMatch(dep('==13.0.0'), [])).toMatchObject({ verdict: 'unverified' });
    });

    test('an ecosystem it cannot order is unverified', () => {
        const result = evaluateMatch(
            { ecosystem: 'MAVEN', name: 'x', version: '1.0.0' },
            [{ ecosystem: 'MAVEN', name: 'x', vulnerableRange: '< 2.0.0' }]
        );

        expect(result.verdict).toBe('unverified');
    });

    test('a Python suffix semver would misorder is unverified', () => {
        expect(evaluateMatch(dep('==13.0rc1'), pillow).verdict).toBe('unverified');
    });

    test('a vendor product match never clears a finding', () => {
        expect(evaluateMatch(dep('==13.0.0', { matchKind: 'vendor_product' }), pillow).verdict).toBe('unverified');
    });

    test('a dependency with no recorded version is unverified', () => {
        expect(evaluateMatch(dep(null), pillow).verdict).toBe('unverified');
    });

    test('an advisory range it cannot read is unverified', () => {
        const result = evaluateMatch(dep('==1.0.0'), [{ ...pillow[0], vulnerableRange: '~> 1.2' }]);
        expect(result.verdict).toBe('unverified');
    });
});

describe('a name that only shares a word with the advisory', () => {
    test('is unaffected when the advisory lists other packages in the ecosystem', () => {
        // GitHub lists the ecosystem itself ("pip") as a technology, so a package
        // called pip matches every pip advisory by name.
        const result = evaluateMatch({ ecosystem: 'PIP', name: 'pip', version: '26.0.1' }, pillow);

        expect(result).toMatchObject({ verdict: 'unaffected', reason: 'The advisory names other packages' });
    });

    test('is unverified when the advisory says nothing about the ecosystem', () => {
        const result = evaluateMatch({ ecosystem: 'NPM', name: 'pillow', version: '1.0.0' }, pillow);
        expect(result.verdict).toBe('unverified');
    });
});
