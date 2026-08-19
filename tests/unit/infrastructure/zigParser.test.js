import { describe, test, expect } from '@jest/globals';

const zig = await import('#app/infrastructure/parsers/zigParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');
const { Ecosystem } = await import('#app/domain/enums/Ecosystem.js');
const { supportsEcosystem, unsupportedReason } = await import('#app/infrastructure/registries/index.js');

// Trimmed from fairyglade/ly, on Zig 0.16: the name is an enum literal and the
// hashes carry a version.
const LY_ZON = `.{
    .name = .ly,
    .version = "1.5.0",
    .fingerprint = 0xa148ffcc5dc2cb59,
    .minimum_zig_version = "0.16.0",
    .dependencies = .{
        .ly_ui = .{
            .path = "ly-ui",
        },
        .clap = .{
            .url = "git+https://github.com/Hejsil/zig-clap#fc1e5cc3f6d9d3001112385ee6256d694e959d2f",
            .hash = "clap-0.11.0-oBajB7foAQC3Iyn4IVCkUdYaOVVng5IZkSncySTjNig1",
        },
        .zlua = .{
            .url = "git+https://github.com/natecraddock/ziglua?ref=zig-0.16#8f271c82baa5fc43aa02a72f6da020c2025d9436",
            .hash = "zlua-0.1.0-hGRpC2aABQD4D9PBVH3wAW8k32-I4969MRQ0CpOwoley",
        },
    },
    .paths = .{
        "build.zig",
        "build.zig.zon",
        "src",
    },
}
`;

// The older shape: a string name and a multihash with no version in it.
const OLD_ZON = `.{
    .name = "myapp",
    .version = "0.1.0",
    .dependencies = .{
        .mach = .{
            .url = "https://pkg.machengine.org/mach/abc123.tar.gz",
            .hash = "1220b1f7f6e9c9f9b5b2a8e6c4d2f0a8e6c4d2f0a8e6c4d2f0a8e6c4d2f0a8e6",
        },
    },
    .paths = .{""},
}
`;

const read = content =>
    Object.fromEntries(zig.parse(content, 'build.zig.zon').map(d => [d.name, d.version]));

describe('the ecosystem', () => {
    // Not a gap that could be closed later: Zig identifies a dependency by
    // content, so there is no registry to ask.
    test('ZIG is declared and says why it has no lookup', () => {
        expect(Ecosystem.ZIG).toBe('ZIG');
        expect(supportsEcosystem('ZIG')).toBe(false);
        expect(unsupportedReason('ZIG')).toMatch(/content-addressed/);
    });
});

describe('discovery', () => {
    test.each([
        ['build.zig.zon', 1],
        ['deps/build.zig.zon', 1],
        // The build script itself, not a manifest.
        ['build.zig', 0],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });
});

describe('build.zig.zon', () => {
    const deps = read(LY_ZON);

    test('reads every dependency', () => {
        expect(Object.keys(deps).sort()).toEqual(['clap', 'ly_ui', 'zlua']);
    });

    // Since Zig 0.14 the hash is <name>-<version>-<digest>, so a version does
    // survive after all — the issue said there was none, and the real file
    // disagreed.
    test('the version comes out of the hash', () => {
        expect(deps['clap']).toBe('0.11.0');
    });

    // ly's own file has zlua-0.1.0-hGRpC2aABQD4D9PBVH3wAW8k32-I4969MRQ0CpOwoley,
    // where the digest itself splits into two segments — so the version cannot be
    // taken by position from the end.
    test('a digest containing a dash does not hide the version', () => {
        expect(deps['zlua']).toBe('0.1.0');
    });

    test('a path dependency has no version', () => {
        expect(deps['ly_ui']).toBeNull();
    });

    describe('what is not a dependency', () => {
        // Reading these would file every project as depending on itself.
        test.each(['ly', 'version', 'fingerprint', 'minimum_zig_version'])('the file\'s own %s', name => {
            expect(deps).not.toHaveProperty(name);
        });

        // .paths is a list of directories in the repository.
        test('the paths list', () => {
            expect(deps).not.toHaveProperty('paths');
            expect(Object.keys(deps)).not.toContain('src');
        });
    });
});

describe('the pre-0.14 shape', () => {
    const deps = read(OLD_ZON);

    test('a multihash carries no version, and the row says so', () => {
        expect(deps).toEqual({ mach: null });
    });

    test("the string form of the file's own name is still not a dependency", () => {
        expect(deps).not.toHaveProperty('myapp');
    });
});

describe('what must not throw', () => {
    test.each([
        ['an empty file', ''],
        ['no dependencies block', '.{\n    .name = .x,\n    .version = "1.0.0",\n}\n'],
        ['an empty dependencies block', '.{\n    .dependencies = .{},\n}\n'],
        ['an unclosed block', '.{\n    .dependencies = .{\n        .a = .{\n'],
    ])('%s', (_label, content) => {
        expect(() => zig.parse(content, 'build.zig.zon')).not.toThrow();
    });
});
