import { describe, test, expect } from '@jest/globals';

const conan = await import('#app/infrastructure/parsers/conanParser.js');
const conanLock = await import('#app/infrastructure/parsers/conanLockParser.js');
const vcpkg = await import('#app/infrastructure/parsers/vcpkgParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');
const { Ecosystem } = await import('#app/domain/enums/Ecosystem.js');
const { supportsEcosystem, unsupportedReason } = await import('#app/infrastructure/registries/index.js');

const CONANFILE_TXT = `[requires]
zlib/1.3.1
openssl/3.2.1
boost/[>=1.84 <2]

[tool_requires]
cmake/3.28.1

[generators]
CMakeDeps
CMakeToolchain

[options]
zlib/*:shared=True
`;

// Trimmed from XRPLF/rippled, which has both a class attribute and calls in
// requirements(), with conditionals around them.
const CONANFILE_PY = `from conan import ConanFile

class Xrpl(ConanFile):
    name = "xrpl"
    license = "ISC"

    requires = [
        "grpc/1.50.1",
        "libarchive/3.7.6",
    ]

    test_requires = [
        "doctest/2.4.11",
    ]

    def requirements(self):
        if self.options.tests:
            self.requires("benchmark/1.9.5")
        self.requires("boost/1.91.0", force=True, transitive_headers=True)
        self.requires("date/3.0.4", transitive_headers=True)
        for name in self.computed_deps:
            self.requires(name)
`;

// Trimmed from XRPLF/rippled. Each reference carries a recipe revision after #
// and a timestamp after %.
const CONAN_LOCK = JSON.stringify({
    version: '0.5',
    requires: [
        'zlib/1.3.2#1cb806da49011867778ffb6ac7190fcb%1782392402.122708',
        'xxhash/0.8.3#681d36a0a6111fc56e5e45ea182c19cc%1782392402.420688',
        'sqlite3/3.53.0#324ada52333108388a9a6108bfa96734%1782392403.185447',
    ],
    build_requires: ['cmake/3.31.5#a1b2c3%1782392404.0'],
    python_requires: [],
});

// Trimmed from isl-org/Open3D. Every dependency is version-less, which is
// ordinary for vcpkg and the thing to get right about it.
const VCPKG_JSON = JSON.stringify({
    $schema: 'https://raw.githubusercontent.com/microsoft/vcpkg-tool/main/docs/vcpkg.schema.json',
    name: 'open3d',
    'version-semver': '0.19.0',
    description: 'Open3D: A Modern Library for 3D Data Processing',
    license: 'MIT',
    dependencies: [
        'eigen3',
        { name: 'assimp', features: ['draco'] },
        { name: 'boost', 'version>=': '1.84.0' },
    ],
    features: {
        gui: { description: 'Build the GUI', dependencies: ['glfw3', 'eigen3'] },
    },
});

const read = (parser, content, file) =>
    Object.fromEntries(parser.parse(content, file).map(d => [d.name, d.version]));

describe('the ecosystems', () => {
    // Conan and vcpkg are separate registries with separate naming, and merging
    // them would make every version lookup ambiguous.
    test('CONAN and VCPKG are separate', () => {
        expect(Ecosystem.CONAN).toBe('CONAN');
        expect(Ecosystem.VCPKG).toBe('VCPKG');
    });

    // Neither registry is a service with a per-package endpoint; both are git
    // trees of recipe directories.
    test.each(['CONAN', 'VCPKG'])('%s says why it has no version lookup', ecosystem => {
        expect(supportsEcosystem(ecosystem)).toBe(false);
        expect(unsupportedReason(ecosystem)).not.toBe('No registry lookup implemented for this ecosystem.');
    });
});

describe('discovery', () => {
    test.each([
        ['conanfile.txt', 1],
        ['conanfile.py', 1],
        ['conan.lock', 1],
        ['vcpkg.json', 1],
        ['cpp/conan.lock', 1],
        // Registry and baseline configuration, not dependencies.
        ['vcpkg-configuration.json', 0],
        // A CMake file is a program, and FetchContent pins a git tag rather than
        // a published version. Deliberately out of scope.
        ['CMakeLists.txt', 0],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });

    test('only the lockfile resolves versions', () => {
        expect(conanLock.resolvesVersions).toBe(true);
        expect(conan.resolvesVersions).toBeUndefined();
        expect(vcpkg.resolvesVersions).toBeUndefined();
    });
});

describe('conanfile.txt', () => {
    const deps = read(conan, CONANFILE_TXT, 'conanfile.txt');

    // A reference is name/version: the version is part of the identifier rather
    // than a field beside it.
    test('splits a reference into name and version', () => {
        expect(deps['zlib']).toBe('1.3.1');
        expect(deps['openssl']).toBe('3.2.1');
    });

    test('a tool requirement counts', () => {
        expect(deps['cmake']).toBe('3.28.1');
    });

    // `[>=1.84 <2]` is what a conanfile writes when it does not pin, and a range
    // is not a resolution.
    test('a version range is not a version', () => {
        expect(deps['boost']).toBeNull();
    });

    test('the settings sections are not requirements', () => {
        expect(Object.keys(deps).sort()).toEqual(['boost', 'cmake', 'openssl', 'zlib']);
    });
});

describe('conanfile.py', () => {
    const deps = read(conan, CONANFILE_PY, 'conanfile.py');

    test('reads a class attribute list', () => {
        expect(deps['grpc']).toBe('1.50.1');
        expect(deps['libarchive']).toBe('3.7.6');
        expect(deps['doctest']).toBe('2.4.11');
    });

    test('reads a self.requires call, conditional or not', () => {
        expect(deps['benchmark']).toBe('1.9.5');
        expect(deps['boost']).toBe('1.91.0');
        expect(deps['date']).toBe('3.0.4');
    });

    // A conanfile is a Python program: requirements can be computed in a loop,
    // and `self.requires(name)` names a variable. A partial read that says what
    // it read beats executing a build script.
    test('a computed requirement is simply not read', () => {
        expect(Object.keys(deps).sort()).toEqual([
            'benchmark',
            'boost',
            'date',
            'doctest',
            'grpc',
            'libarchive',
        ]);
    });

    test("the recipe's own name and license are not requirements", () => {
        expect(deps).not.toHaveProperty('xrpl');
        expect(deps).not.toHaveProperty('ISC');
    });
});

describe('conan.lock', () => {
    const deps = read(conanLock, CONAN_LOCK, 'conan.lock');

    // zlib/1.3.2#1cb806da4901…%1782392402.122708 — the recipe revision and the
    // timestamp are not part of the version.
    test('the revision and timestamp come off', () => {
        expect(deps['zlib']).toBe('1.3.2');
        expect(Object.values(deps).some(version => /[#%]/.test(version))).toBe(false);
    });

    test('build requirements count', () => {
        expect(deps['cmake']).toBe('3.31.5');
    });

    test('an empty section is not a problem', () => {
        expect(Object.keys(deps)).toHaveLength(4);
    });
});

describe('vcpkg.json', () => {
    const deps = read(vcpkg, VCPKG_JSON, 'vcpkg.json');

    // Unlike every other manifest here, a vcpkg dependency usually has no
    // version: the registry baseline decides it, not the manifest. Open3D's real
    // manifest has 23 dependencies and not one carries a version.
    test('a bare dependency has no version, and that is the right answer', () => {
        expect(deps['eigen3']).toBeNull();
        expect(deps['assimp']).toBeNull();
    });

    // A floor is better than nothing, and it is the only version a manifest can
    // carry.
    test('a version>= floor is stored', () => {
        expect(deps['boost']).toBe('1.84.0');
    });

    // A feature's dependencies install only when the feature is enabled, but a
    // repository declaring one is a repository that can build it.
    test("a feature's dependencies count", () => {
        expect(Object.keys(deps)).toContain('glfw3');
    });

    test('a dependency in both places is one row', () => {
        expect(vcpkg.parse(VCPKG_JSON, 'vcpkg.json').filter(d => d.name === 'eigen3')).toHaveLength(1);
    });

    test("the manifest's own name and version are not a dependency", () => {
        expect(deps).not.toHaveProperty('open3d');
        expect(Object.keys(deps).sort()).toEqual(['assimp', 'boost', 'eigen3', 'glfw3']);
    });
});

describe('what must not throw', () => {
    test.each([
        [conan, 'conanfile.txt', '[generators]\nCMakeDeps\n'],
        [conan, 'conanfile.txt', ''],
        [conan, 'conanfile.py', 'from conan import ConanFile\n\nclass X(ConanFile):\n    pass\n'],
        [conanLock, 'conan.lock', 'not json'],
        [conanLock, 'conan.lock', '{"version": "0.5"}'],
        [vcpkg, 'vcpkg.json', 'not json'],
        [vcpkg, 'vcpkg.json', '{"name": "x"}'],
    ])('%#', (parser, file, content) => {
        expect(parser.parse(content, file)).toEqual([]);
    });

    // A reference with no slash is not a reference.
    test('a malformed conan reference is skipped', () => {
        expect(conan.parse('[requires]\nzlib\n', 'conanfile.txt')).toEqual([]);
    });
});
