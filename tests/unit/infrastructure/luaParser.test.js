import { describe, test, expect } from '@jest/globals';

const lua = await import('#app/infrastructure/parsers/luaParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');
const { Ecosystem } = await import('#app/domain/enums/Ecosystem.js');
const { supportsEcosystem, unsupportedReason } = await import('#app/infrastructure/registries/index.js');

// Trimmed from lunarmodules/Penlight, which builds its own version out of local
// variables and still writes the dependency tables literally.
const PENLIGHT_ROCKSPEC = `local package_name = "penlight"
local package_version = "1.14.0"
local rockspec_revision = "1"

rockspec_format = "3.0"
package = package_name
version = package_version .. "-" .. rockspec_revision

source = {
  url = "git+https://github.com/lunarmodules/penlight.git",
  branch = "master"
}

description = {
  summary = "Lua utility libraries loosely based on the Python standard libraries",
  license = "MIT/X11",
  maintainer = "thijs@thijsschreijer.nl",
}

dependencies = {
  "lua >= 5.1",
  "luafilesystem"
}

build_dependencies = {
  "cmake >= 3.0",
}

test_dependencies = {
  "busted",
}

build = {
  type = "builtin",
}
`;

// The dependencies are computed, which a parser that does not run Lua cannot see.
const COMPUTED_ROCKSPEC = `package = "thing"
version = "1.0-1"
dependencies = deps_for(_VERSION)
`;

const read = content =>
    Object.fromEntries(lua.parse(content, 'penlight-1.14.0-1.rockspec').map(d => [d.name, d.version]));

describe('the ecosystem', () => {
    test('LUAROCKS is declared and says why it has no lookup yet', () => {
        expect(Ecosystem.LUAROCKS).toBe('LUAROCKS');
        expect(supportsEcosystem('LUAROCKS')).toBe(false);
        expect(unsupportedReason('LUAROCKS')).toMatch(/LuaRocks manifest/);
    });
});

describe('discovery', () => {
    test.each([
        ['penlight-1.14.0-1.rockspec', 1],
        ['rockspecs/penlight-dev-1.rockspec', 1],
        ['init.lua', 0],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });
});

describe('a rockspec', () => {
    const deps = read(PENLIGHT_ROCKSPEC);

    test('reads a dependency with its constraint', () => {
        expect(Object.keys(deps)).toContain('luafilesystem');
    });

    test('build and test dependencies count', () => {
        expect(deps['cmake']).toBe('>= 3.0');
        expect(Object.keys(deps)).toContain('busted');
    });

    test('a bare name has no constraint', () => {
        expect(deps['luafilesystem']).toBeNull();
        expect(deps['busted']).toBeNull();
    });

    // The interpreter, constrained in the same table as the packages, the same
    // way ocaml is under opam and python under a Poetry table.
    test('lua is the interpreter, not a package', () => {
        expect(deps).not.toHaveProperty('lua');
    });

    describe('what is not a dependency', () => {
        // These tables are full of quoted strings, so scanning the whole file
        // would produce rows out of the description and the source URL.
        test('the description and source tables', () => {
            expect(deps).not.toHaveProperty('summary');
            expect(deps).not.toHaveProperty('branch');
            expect(deps).not.toHaveProperty('type');
        });

        test('only the three dependency tables are read', () => {
            expect(Object.keys(deps).sort()).toEqual(['busted', 'cmake', 'luafilesystem']);
        });
    });
});

describe('what must not throw', () => {
    // A rockspec is a Lua program, so a computed table is simply not read — the
    // same limit conanParser puts on conanfile.py.
    test('a computed dependencies table reads as nothing rather than throwing', () => {
        expect(lua.parse(COMPUTED_ROCKSPEC, 'thing-1.0-1.rockspec')).toEqual([]);
    });

    test.each([
        ['an empty file', ''],
        ['a rockspec with no dependencies', 'package = "x"\nversion = "1.0-1"\n'],
        ['an empty table', 'dependencies = {}\n'],
    ])('%s', (_label, content) => {
        expect(lua.parse(content, 'x-1.0-1.rockspec')).toEqual([]);
    });
});
