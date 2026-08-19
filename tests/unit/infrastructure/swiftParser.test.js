import { describe, test, expect } from '@jest/globals';

const parser = await import('#app/infrastructure/parsers/swiftParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');

// Written by Xcode 13 and by anything still on Swift 5.5.
const VERSION_1 = JSON.stringify({
    object: {
        pins: [
            {
                package: 'Alamofire',
                repositoryURL: 'https://github.com/Alamofire/Alamofire.git',
                state: {
                    branch: null,
                    revision: 'f455c2975872ccd2d9c81594c658af65716e9b9a',
                    version: '5.9.1',
                },
            },
            {
                package: 'SnapKit',
                repositoryURL: 'https://github.com/SnapKit/SnapKit.git',
                state: {
                    branch: 'develop',
                    revision: 'f222cbdf325885926566172f6f5f06af95473158',
                    version: null,
                },
            },
        ],
    },
    version: 1,
});

// Written by anything current: the pins are hoisted and named by identity.
const VERSION_2 = JSON.stringify({
    pins: [
        {
            identity: 'swift-collections',
            kind: 'remoteSourceControl',
            location: 'https://github.com/apple/swift-collections.git',
            state: {
                revision: '94cf62b3ba8d4bed62680a282d4bd1f6a761b3d1',
                version: '1.1.4',
            },
        },
        {
            identity: 'swift-nio',
            kind: 'remoteSourceControl',
            location: 'https://github.com/apple/swift-nio.git',
            state: {
                revision: '6213ba7a06badfba3a4d6a7ffb18acc06f6bfb2b',
            },
        },
    ],
    version: 2,
});

describe('lockfile discovery', () => {
    test.each([
        ['Package.resolved', 1],
        ['App.xcworkspace/xcshareddata/swiftpm/Package.resolved', 1],
        ['Package.swift', 0],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });
});

describe('version 1', () => {
    const deps = parser.parse(VERSION_1, 'Package.resolved');

    test('reads a pin named by its repository', () => {
        expect(deps[0]).toMatchObject({
            ecosystem: 'SWIFT',
            name: 'Alamofire',
            version: '5.9.1',
            manifestFile: 'Package.resolved',
        });
    });

    // The revision is what is in the build, but it is not a version, and
    // reporting it as one would make every comparison against a registry lie.
    test('a pin following a branch has no version', () => {
        expect(deps[1]).toMatchObject({ name: 'SnapKit', version: null });
    });
});

describe('version 2', () => {
    const deps = parser.parse(VERSION_2, 'Package.resolved');

    test('reads a pin named by its identity', () => {
        expect(deps[0]).toMatchObject({ name: 'swift-collections', version: '1.1.4' });
    });

    test('a pin resolved to a bare revision has no version', () => {
        expect(deps[1]).toMatchObject({ name: 'swift-nio', version: null });
    });
});

describe('what must not throw', () => {
    test('a file that is not JSON is no dependencies, not a crash', () => {
        expect(parser.parse('// swift-tools-version:5.9', 'Package.resolved')).toEqual([]);
    });

    test('a lockfile with no pins at all', () => {
        expect(parser.parse(JSON.stringify({ pins: [], version: 3 }), 'Package.resolved')).toEqual([]);
    });
});
