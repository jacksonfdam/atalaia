import { describe, test, expect } from '@jest/globals';

const parser = await import('#app/infrastructure/parsers/cocoapodsParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');

// Trimmed from a real lockfile: the sections after PODS say the same names
// again, which is what makes double counting so easy to do by accident.
const PODFILE_LOCK = `PODS:
  - Alamofire (5.9.1)
  - Firebase/Analytics (10.24.0):
    - Firebase/Core
    - FirebaseAnalytics (~> 10.24.0)
  - Firebase/Core (10.24.0):
    - FirebaseAnalytics (~> 10.24.0)
  - FirebaseAnalytics (10.24.0):
    - FirebaseCore (~> 10.24.0)
    - GoogleUtilities/Network (~> 7.11)
  - "GoogleUtilities/Network (7.13.0)"

DEPENDENCIES:
  - Alamofire (~> 5.9)
  - Firebase/Analytics

SPEC REPOS:
  trunk:
    - Alamofire
    - Firebase

SPEC CHECKSUMS:
  Alamofire: f455c2975872ccd2d9c81594c658af65716e9b9a

PODFILE CHECKSUM: 6213ba7a06badfba3a4d6a7ffb18acc06f6bfb2b

COCOAPODS: 1.15.2
`;

const deps = parser.parse(PODFILE_LOCK, 'Podfile.lock');
const byName = name => deps.filter(dependency => dependency.name === name);

describe('lockfile discovery', () => {
    test.each([
        ['Podfile.lock', 1],
        ['ios/Podfile.lock', 1],
        // Read since #38: an iOS project that does not commit its lockfile.
        ['Podfile', 1],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });
});

describe('what is read', () => {
    test('a plain pod', () => {
        expect(byName('Alamofire')[0]).toMatchObject({
            ecosystem: 'COCOAPODS',
            version: '5.9.1',
            manifestFile: 'Podfile.lock',
        });
    });

    // Advising on Firebase when the build has Firebase/Analytics is advising
    // about a different package.
    test('a subspec keeps its full name', () => {
        expect(byName('Firebase/Analytics')[0]).toMatchObject({ version: '10.24.0' });
    });

    test('a quoted name loses only the quotes', () => {
        expect(byName('GoogleUtilities/Network')[0]).toMatchObject({ version: '7.13.0' });
    });
});

describe('what is not read twice', () => {
    // FirebaseAnalytics is nested under three pods and listed once at the top
    // level. Counting the nested lines would report it four times, each with
    // the constraint `(~> 10.24.0)` in place of the resolved version.
    test('a pod nested under another is counted once, at its own entry', () => {
        expect(byName('FirebaseAnalytics')).toHaveLength(1);
        expect(byName('FirebaseAnalytics')[0].version).toBe('10.24.0');
    });

    test('nothing carries a version range', () => {
        for (const dependency of deps) {
            expect(dependency.version).not.toMatch(/[~>=<]/);
        }
    });

    test('the sections after PODS are not dependencies', () => {
        expect(deps).toHaveLength(5);
        expect(byName('trunk')).toHaveLength(0);
    });
});

describe('what must not throw', () => {
    test('a lockfile with no PODS section', () => {
        expect(parser.parse('PODFILE CHECKSUM: abc\n\nCOCOAPODS: 1.15.2\n', 'Podfile.lock')).toEqual([]);
    });

    test('an empty file', () => {
        expect(parser.parse('', 'Podfile.lock')).toEqual([]);
    });
});
