import { describe, test, expect } from '@jest/globals';

const opam = await import('#app/infrastructure/parsers/opamParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');
const { Ecosystem } = await import('#app/domain/enums/Ecosystem.js');
const { supportsEcosystem, unsupportedReason } = await import('#app/infrastructure/registries/index.js');

// Trimmed from ocsigen/lwt. The build markers alongside the constraints are the
// part to get right.
const LWT_OPAM = `opam-version: "2.0"
synopsis: "Promises and event-driven I/O"
maintainer: ["Anton Bachin"]
license: "MIT"

depends: [
  "dune" {>= "3.18"}
  "ocaml" {>= "4.14"}
  "cppo" {build & >= "1.1"}
  "odoc" {with-doc & >= "2.3"}
  "alcotest" {dev}
  "dune-configurator"
  "ocplib-endian"
]
depopts: ["base-threads" "base-unix" "conf-libev"]
dev-repo: "git+https://github.com/ocsigen/lwt.git"
build: [
  ["dune" "subst"] {dev}
]
`;

// Trimmed from ocaml/dune, whose depends form holds a three-line comment and
// which has several package stanzas each with their own.
const DUNE_PROJECT = `(lang dune 3.17)
(name dune)

(package
 (name dune-build-info)
 (depends
  ; NOTE: The wider OCaml ecosystem can be deeply affected by changes to the dune
  ; lower bound. Increases should be announced in advance, and only occur at
  ; minor version bounds.
  (ocaml (>= 4.14)))
 (description "Access to build information"))

(package
 (name dune-glob)
 (depends
  (csexp (>= 1.5.0))
  (pp (>= 1.1.0))
  dyn
  stdune))
`;

const read = (content, file) =>
    Object.fromEntries(opam.parse(content, file).map(d => [d.name, d.version]));

describe('the ecosystem', () => {
    test('OPAM is declared, and says why it has no version lookup', () => {
        expect(Ecosystem.OPAM).toBe('OPAM');
        expect(supportsEcosystem('OPAM')).toBe(false);
        expect(unsupportedReason('OPAM')).toMatch(/git tree/);
    });
});

describe('discovery', () => {
    test.each([
        ['opam', 1],
        ['lwt.opam', 1],
        ['dune-project', 1],
        ['src/thing.opam', 1],
        // A `dune` file declares libraries to build, not packages to fetch.
        ['dune', 0],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });

    test('neither file resolves a version', () => {
        expect(opam.resolvesVersions).toBeUndefined();
    });
});

describe('an opam file', () => {
    const deps = read(LWT_OPAM, 'lwt.opam');

    test('reads a constraint out of the braces', () => {
        expect(deps['dune']).toBe('>= 3.18');
    });

    // lwt writes `"cppo" {build & >= "1.1"}`: a build marker and a version in the
    // same expression.
    test('a build marker alongside a constraint does not hide it', () => {
        expect(deps['cppo']).toBe('>= 1.1');
        expect(deps['odoc']).toBe('>= 2.3');
    });

    // `{dev}` is a marker with no comparison in it.
    test('a marker with no comparison pins nothing', () => {
        expect(deps['alcotest']).toBeNull();
    });

    test('a dependency with no braces at all', () => {
        expect(deps['ocplib-endian']).toBeNull();
    });

    // An optional dependency is a real dependency when it is present.
    test('depopts count', () => {
        expect(Object.keys(deps)).toContain('conf-libev');
    });

    // The compiler is constrained in the same list as the packages, the same way
    // python is under a Poetry table.
    test('ocaml is the compiler, not a package', () => {
        expect(deps).not.toHaveProperty('ocaml');
    });

    test('the other fields are not dependencies', () => {
        expect(deps).not.toHaveProperty('maintainer');
        expect(Object.keys(deps).sort()).toEqual([
            'alcotest',
            'base-threads',
            'base-unix',
            'conf-libev',
            'cppo',
            'dune',
            'dune-configurator',
            'ocplib-endian',
            'odoc',
        ]);
    });
});

describe('a dune-project', () => {
    const deps = read(DUNE_PROJECT, 'dune-project');

    test('reads a parenthesised pair as a name and a constraint', () => {
        expect(deps['csexp']).toBe('>= 1.5.0');
        expect(deps['pp']).toBe('>= 1.1.0');
    });

    test('a bare atom is a dependency with no constraint', () => {
        expect(deps['dyn']).toBeNull();
        expect(deps['stdune']).toBeNull();
    });

    test('every package stanza contributes its own depends form', () => {
        expect(Object.keys(deps).sort()).toEqual(['csexp', 'dyn', 'pp', 'stdune']);
    });

    // dune's own file has a three-line comment inside a depends form. Reading it
    // would produce a row for every word in the prose.
    test('a comment inside the depends form is not dependencies', () => {
        expect(deps).not.toHaveProperty('NOTE');
        expect(Object.keys(deps)).not.toContain('ecosystem');
    });

    // (name dune-glob) and (description "…") are the package's own fields, and
    // they sit as siblings of the depends form rather than inside it.
    test("the package's own name is not a dependency", () => {
        expect(deps).not.toHaveProperty('dune-glob');
        expect(deps).not.toHaveProperty('dune-build-info');
    });

    test('ocaml is still the compiler here', () => {
        expect(deps).not.toHaveProperty('ocaml');
    });
});

describe('what must not throw', () => {
    test.each([
        ['an empty opam file', '', 'lwt.opam'],
        ['an opam file with no depends', 'opam-version: "2.0"\nlicense: "MIT"\n', 'opam'],
        ['a dune-project with no depends', '(lang dune 3.17)\n(name x)\n', 'dune-project'],
        ['an unclosed depends form', '(depends (csexp (>= 1.5.0))', 'dune-project'],
    ])('%s', (_label, content, file) => {
        expect(() => opam.parse(content, file)).not.toThrow();
    });
});
