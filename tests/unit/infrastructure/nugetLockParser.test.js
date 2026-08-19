import { describe, test, expect } from '@jest/globals';

const nuget = await import('#app/infrastructure/parsers/nugetLockParser.js');
const paket = await import('#app/infrastructure/parsers/paketParser.js');
const paketLock = await import('#app/infrastructure/parsers/paketLockParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');

/**
 * What .NET actually restores.
 *
 * `.csproj` carries a constraint; these carry the version in the output. Three
 * of the four fixtures are trimmed from real files — ThreeMammals/Ocelot and
 * fsprojects/Paket. `packages.config` is written from the documented shape,
 * which has not changed since 2010; it is the one fixture here not taken from a
 * repository.
 */

// Trimmed from ThreeMammals/Ocelot: 27 entries for 9 packages across three
// target frameworks, which is what makes the deduplication the point.
const PACKAGES_LOCK = JSON.stringify({
    version: 1,
    dependencies: {
        'net8.0': {
            FluentValidation: { type: 'Direct', requested: '[12.1.1, )', resolved: '12.1.1', contentHash: 'fake' },
            'Microsoft.AspNetCore.MiddlewareAnalysis': { type: 'Direct', requested: '[8.0.29, )', resolved: '8.0.29', contentHash: 'fake' },
            'System.Text.Json': { type: 'Transitive', resolved: '8.0.5', contentHash: 'fake' },
            'Ocelot.Provider.Consul': { type: 'Project' },
        },
        'net9.0': {
            FluentValidation: { type: 'Direct', requested: '[12.1.1, )', resolved: '12.1.1', contentHash: 'fake' },
            'Microsoft.AspNetCore.MiddlewareAnalysis': { type: 'Direct', requested: '[9.0.10, )', resolved: '9.0.10', contentHash: 'fake' },
        },
        'net10.0': {
            'Microsoft.AspNetCore.MiddlewareAnalysis': { type: 'Direct', requested: '[10.0.10, )', resolved: '10.0.10', contentHash: 'fake' },
        },
    },
});

const PACKAGES_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Newtonsoft.Json" version="13.0.3" targetFramework="net472" />
  <package targetFramework="net472" version="4.5.0" id="System.Buffers" />
  <package id="NoVersion" targetFramework="net472" />
</packages>
`;

// Trimmed from fsprojects/Paket's own files.
const PAKET_DEPENDENCIES = `source https://api.nuget.org/v3/index.json

storage: none
content: none

nuget Newtonsoft.Json >= 10.0.3 redirects: force
nuget Argu >= 5.1.0
nuget Mono.Cecil ~> 0.11.1
nuget DotNet.ReproducibleBuilds copy_local: true
nuget FSharp.Core

github fsharp/FAKE src/app/FakeLib/Globbing/Globbing.fs

group Build
  source https://api.nuget.org/v3/index.json
  nuget FAKE ~> 5.20
`;

const PAKET_LOCK = `STORAGE: NONE
CONTENT: NONE
NUGET
  remote: https://api.nuget.org/v3/index.json
    Argu (6.1.1)
      FSharp.Core (>= 4.3.2) - restriction: >= netstandard2.0
      System.Configuration.ConfigurationManager (>= 4.4)
    Chessie (0.6)
      FSharp.Core (>= 4.0.0.1)
    FSharp.Core (9.0.303)
GITHUB
  remote: fsharp/FAKE
    src/app/FakeLib/Globbing/Globbing.fs (0341a2e614eb2a7f34607cec914eb0ed83ce9add)
  remote: forki/FsUnit
    FsUnit.fs (7bc9b7d0e7f0c1d7f2b3a4c5d6e7f8091a2b3c4d)
GROUP Build
CONTENT: NONE
RESTRICTION: >= net461
NUGET
  remote: https://api.nuget.org/v3/index.json
    FAKE (5.20.4)
    FSharp.Core (4.7.2)
`;

const read = (parser, content, file) =>
    Object.fromEntries(parser.parse(content, file).map(d => [d.name, d.version]));

describe('discovery', () => {
    test.each([
        ['packages.lock.json', 1],
        ['packages.config', 1],
        ['paket.dependencies', 1],
        ['paket.lock', 1],
        ['src/Api/packages.lock.json', 1],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });

    test('the two lockfiles resolve versions and paket.dependencies does not', () => {
        expect(nuget.resolvesVersions).toBe(true);
        expect(paketLock.resolvesVersions).toBe(true);
        expect(paket.resolvesVersions).toBeUndefined();
    });
});

describe('packages.lock.json', () => {
    const deps = read(nuget, PACKAGES_LOCK, 'packages.lock.json');

    test('reads a direct package', () => {
        expect(deps['FluentValidation']).toBe('12.1.1');
    });

    // A package restored into the output is in the output however it got there.
    test('a transitive package counts', () => {
        expect(deps['System.Text.Json']).toBe('8.0.5');
    });

    // Ocelot lists the same 9 packages under net8.0, net9.0 and net10.0. Without
    // collapsing that, every count the console shows triples.
    test('a package under three frameworks is one row', () => {
        expect(Object.keys(deps)).toHaveLength(3);
    });

    // 8.0.29 under net8.0, 10.0.10 under net10.0. See pickVersion.js.
    test('the lower version across frameworks is the one kept', () => {
        expect(deps['Microsoft.AspNetCore.MiddlewareAnalysis']).toBe('8.0.29');
    });

    // A Project entry is another project in the solution: code in this
    // repository rather than a package to advise about.
    test('a project reference is not a package', () => {
        expect(deps).not.toHaveProperty('Ocelot.Provider.Consul');
    });
});

describe('packages.config', () => {
    const deps = read(nuget, PACKAGES_CONFIG, 'packages.config');

    test('reads a package at its exact version', () => {
        expect(deps['Newtonsoft.Json']).toBe('13.0.3');
    });

    // The format predates floating versions, so its version is exact by
    // construction — which is what makes a manifest authoritative here.
    test('attribute order does not matter', () => {
        expect(deps['System.Buffers']).toBe('4.5.0');
    });

    test('an element with no version reports unknown rather than being dropped', () => {
        expect(deps['NoVersion']).toBeNull();
    });

    test('the xml declaration is not a package', () => {
        expect(Object.keys(deps)).toHaveLength(3);
    });
});

describe('paket.dependencies', () => {
    const deps = read(paket, PAKET_DEPENDENCIES, 'paket.dependencies');

    test('reads a nuget line with its constraint', () => {
        expect(deps['Newtonsoft.Json']).toBe('>= 10.0.3');
        expect(deps['Mono.Cecil']).toBe('~> 0.11.1');
    });

    // Paket's own file has `nuget DotNet.ReproducibleBuilds copy_local: true`:
    // a setting and no constraint at all. Storing the setting as the version
    // would make it uncomparable.
    test('a setting is not a constraint', () => {
        expect(deps['DotNet.ReproducibleBuilds']).toBeNull();
        expect(deps['Newtonsoft.Json']).not.toMatch(/redirects/);
    });

    test('a bare nuget line has no constraint', () => {
        expect(deps['FSharp.Core']).toBeNull();
    });

    test('a group is read as well', () => {
        expect(deps['FAKE']).toBe('~> 5.20');
    });

    // `github fsharp/FAKE src/app/…/Globbing.fs` pulls a single source file into
    // the build. It is not a package and nothing on nuget.org answers about it.
    test('a github line is not a package', () => {
        expect(deps).not.toHaveProperty('fsharp/FAKE');
        expect(Object.keys(deps)).toHaveLength(6);
    });

    test('source and storage lines are not packages', () => {
        expect(deps).not.toHaveProperty('source');
        expect(deps).not.toHaveProperty('storage');
    });
});

describe('paket.lock', () => {
    const deps = read(paketLock, PAKET_LOCK, 'paket.lock');

    test('reads a package at its resolved version', () => {
        expect(deps['Argu']).toBe('6.1.1');
        expect(deps['Chessie']).toBe('0.6');
    });

    // A package's own dependencies sit two spaces deeper with a constraint.
    test('a nested constraint line is not a row', () => {
        expect(Object.values(deps).some(version => version.includes('>='))).toBe(false);
        expect(deps).not.toHaveProperty('System.Configuration.ConfigurationManager');
    });

    // A GITHUB section lists source files at the same indentation as a package,
    // with a commit in the brackets where a version would be.
    test('a GITHUB source file is not a package', () => {
        expect(deps).not.toHaveProperty('src/app/FakeLib/Globbing/Globbing.fs');
        expect(deps).not.toHaveProperty('FsUnit.fs');
    });

    // A GROUP starts a whole new set of sections, so being inside NUGET cannot
    // be decided once at the top of the file.
    test('a package in a group is read', () => {
        expect(deps['FAKE']).toBe('5.20.4');
    });

    test('a package in two groups at two versions keeps the lower one', () => {
        expect(deps['FSharp.Core']).toBe('4.7.2');
    });

    test('the section markers are not packages', () => {
        expect(Object.keys(deps).sort()).toEqual(['Argu', 'Chessie', 'FAKE', 'FSharp.Core']);
    });
});

describe('what must not throw', () => {
    test.each([
        [nuget, 'packages.lock.json', 'not json'],
        [nuget, 'packages.lock.json', '{}'],
        [nuget, 'packages.config', '<packages></packages>'],
        [paket, 'paket.dependencies', 'source https://api.nuget.org/v3/index.json\n'],
        [paketLock, 'paket.lock', 'NUGET\n  remote: https://api.nuget.org/v3/index.json\n'],
        [paketLock, 'paket.lock', ''],
    ])('%#', (parser, file, content) => {
        expect(parser.parse(content, file)).toEqual([]);
    });
});
