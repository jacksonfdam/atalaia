import { describe, test, expect } from '@jest/globals';

const manifest = await import('#app/infrastructure/parsers/swiftManifestParser.js');
const resolved = await import('#app/infrastructure/parsers/swiftParser.js');
const podfile = await import('#app/infrastructure/parsers/podfileParser.js');
const podlock = await import('#app/infrastructure/parsers/cocoapodsParser.js');
const cartfile = await import('#app/infrastructure/parsers/carthageParser.js');
const cartlock = await import('#app/infrastructure/parsers/carthageLockParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');

// Trimmed from vapor/vapor, plus the argument forms its file does not use.
const PACKAGE_SWIFT = `// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "vapor",
    dependencies: [
        .package(url: "https://github.com/apple/swift-nio.git", from: "2.101.3"),
        .package(url: "https://github.com/apple/swift-configuration.git", from: "1.0.0", traits: ["CommandLineArguments"]),
        .package(url: "https://github.com/Alamofire/Alamofire.git", exact: "5.9.1"),
        .package(url: "https://github.com/SnapKit/SnapKit.git", branch: "develop"),
        .package(url: "https://github.com/someone/pinned.git", revision: "aabbccddeeff00112233445566778899aabbccdd"),
        .package(url: "https://github.com/apple/swift-log.git", .upToNextMajor(from: "1.14.0")),
        .package(url: "https://github.com/apple/swift-metrics.git", "2.0.0"..<"3.0.0"),
        .package(path: "../local-thing"),
    ]
)
`;

const PODFILE = `platform :ios, '8.0'
use_frameworks!

target 'App' do
  pod 'Alamofire', '~> 5.9'
  pod 'Firebase/Analytics'
  pod 'DeepLinkKit', :path => '.'
  pod 'Forked', :git => 'https://github.com/someone/forked.git', :branch => 'main'
end
`;

// Trimmed from ReactiveCocoa/ReactiveCocoa.
const CARTFILE = `github "xcconfigs/xcconfigs" ~> 1.1
github "Quick/Quick" ~> 4.0
binary "https://example.com/Thing.json" ~> 1.0
`;

const CARTFILE_RESOLVED = `github "Quick/Nimble" "v9.2.1"
github "Quick/Quick" "v4.0.0"
github "ReactiveCocoa/ReactiveSwift" "f4f3d4d7375ce26a797f7f0b4c246444c3afd43f"
github "xcconfigs/xcconfigs" "1.1"
`;

const read = (parser, content, file) =>
    Object.fromEntries(parser.parse(content, file).map(d => [d.name, d.version]));

describe('discovery', () => {
    test.each([
        ['Package.swift', 1],
        ['Podfile', 1],
        ['Cartfile', 1],
        ['Cartfile.private', 1],
        ['Cartfile.resolved', 1],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });

    test('the manifests do not claim to resolve versions and the lockfiles do', () => {
        expect(manifest.resolvesVersions).toBeUndefined();
        expect(podfile.resolvesVersions).toBeUndefined();
        expect(cartfile.resolvesVersions).toBeUndefined();
        expect(cartlock.resolvesVersions).toBe(true);
        expect(resolved.resolvesVersions).toBe(true);
        expect(podlock.resolvesVersions).toBe(true);
    });
});

describe('Package.swift', () => {
    const deps = read(manifest, PACKAGE_SWIFT, 'Package.swift');

    // The name is not in the call: SPM derives the identity from the URL's last
    // path component, without .git, lowercased.
    test('the identity comes from the URL', () => {
        expect(deps['swift-nio']).toBe('from 2.101.3');
        expect(deps['alamofire']).toBe('5.9.1');
    });

    // Without this the manifest row and the lockfile row are two packages, and
    // reconcileDependencies cannot supersede one with the other.
    test('the identity matches what Package.resolved produces', () => {
        const fromLock = resolved.parse(
            JSON.stringify({
                object: { pins: [{ package: 'Alamofire', state: { version: '5.9.1' } }] },
                version: 1,
            }),
            'Package.resolved'
        );

        expect(fromLock[0].name).toBe('alamofire');
        expect(Object.keys(deps)).toContain('alamofire');
    });

    test('a range helper and a range literal are both read', () => {
        expect(deps['swift-log']).toBe('from 1.14.0');
        expect(deps['swift-metrics']).toBe('2.0.0 ..< 3.0.0');
    });

    test('a trailing argument after the version does not hide it', () => {
        expect(deps['swift-configuration']).toBe('from 1.0.0');
    });

    // There is no published version to compare a branch or a revision against.
    test.each(['snapkit', 'pinned'])('%s names a source, so its version is unknown', name => {
        expect(deps[name]).toBeNull();
    });

    // A path dependency is a directory in this repository: no identity on any
    // registry and no CVE can match it.
    test('a path dependency is not a dependency', () => {
        expect(deps).not.toHaveProperty('local-thing');
        expect(Object.keys(deps)).toHaveLength(7);
    });
});

describe('Podfile', () => {
    const deps = read(podfile, PODFILE, 'Podfile');

    test('reads a pod with its constraint', () => {
        expect(deps['Alamofire']).toBe('~> 5.9');
    });

    // Firebase and Firebase/Analytics are different things to advise about, and
    // the name has to match what cocoapodsParser produces from Podfile.lock.
    test('a subspec keeps its full name', () => {
        expect(Object.keys(deps)).toContain('Firebase/Analytics');
    });

    // DeepLinkKit's own Podfile is `pod 'DeepLinkKit', :path => '.'` — its own code.
    test.each(['DeepLinkKit', 'Forked'])('%s names a source, so its version is unknown', name => {
        expect(deps[name]).toBeNull();
    });

    test('the platform and target lines are not pods', () => {
        expect(Object.keys(deps).sort()).toEqual([
            'Alamofire',
            'DeepLinkKit',
            'Firebase/Analytics',
            'Forked',
        ]);
    });
});

describe('Carthage', () => {
    // Carthage resolves against GitHub releases exactly as SPM does, and a CVE
    // naming Alamofire does not care which tool fetched it.
    test('the rows are SWIFT rather than an ecosystem of their own', () => {
        expect(cartfile.parse(CARTFILE, 'Cartfile').every(d => d.ecosystem === 'SWIFT')).toBe(true);
    });

    test('a Cartfile carries constraints', () => {
        expect(read(cartfile, CARTFILE, 'Cartfile')).toEqual({
            xcconfigs: '~> 1.1',
            quick: '~> 4.0',
            thing: '~> 1.0',
        });
    });

    // A binary entry points at a JSON specification rather than a repository, so
    // its last path component carries an extension that is not part of the name.
    test('a binary entry loses the .json from its identity', () => {
        expect(Object.keys(read(cartfile, CARTFILE, 'Cartfile'))).toContain('thing');
    });

    describe('Cartfile.resolved', () => {
        const deps = read(cartlock, CARTFILE_RESOLVED, 'Cartfile.resolved');

        // Tags carry a v prefix as often as not, and v9.2.1 and 9.2.1 are the
        // same release.
        test('a v prefix comes off the tag', () => {
            expect(deps['nimble']).toBe('9.2.1');
            expect(deps['quick']).toBe('4.0.0');
        });

        // ReactiveCocoa's own resolved file pins ReactiveSwift to a commit rather
        // than a tag, and a commit is not something to compare against a release.
        test('a commit SHA is not a version', () => {
            expect(Object.keys(deps)).toContain('reactiveswift');
            expect(deps['reactiveswift']).toBeNull();
        });

        test('the identity is derived the same way as SPM does', () => {
            expect(Object.keys(deps).sort()).toEqual([
                'nimble',
                'quick',
                'reactiveswift',
                'xcconfigs',
            ]);
        });
    });
});

describe('what must not throw', () => {
    test.each([
        [manifest, 'Package.swift', '// swift-tools-version:6.0\nimport PackageDescription\n'],
        [manifest, 'Package.swift', ''],
        [podfile, 'Podfile', "platform :ios, '15.0'\n"],
        [cartfile, 'Cartfile', '# nothing here\n'],
        [cartlock, 'Cartfile.resolved', ''],
    ])('%#', (parser, file, content) => {
        expect(parser.parse(content, file)).toEqual([]);
    });
});
