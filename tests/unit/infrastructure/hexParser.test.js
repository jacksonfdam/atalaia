import { describe, test, expect } from '@jest/globals';

const hex = await import('#app/infrastructure/parsers/hexParser.js');
const lock = await import('#app/infrastructure/parsers/hexLockParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');
const { Ecosystem } = await import('#app/domain/enums/Ecosystem.js');
const { supportsEcosystem } = await import('#app/infrastructure/registries/index.js');

// Trimmed from phoenixframework/phoenix.
const MIX_EXS = `defmodule Phoenix.MixProject do
  use Mix.Project

  @version "1.7.18"

  def project do
    [
      app: :phoenix,
      version: @version,
      description: "Peace of mind from prototype to production",
      package: package(),
      deps: deps()
    ]
  end

  defp deps do
    [
      {:plug, "~> 1.14"},
      {:telemetry, "~> 0.4 or ~> 1.0"},

      # TODO Drop phoenix_view in v2.0
      {:phoenix_view, "~> 2.0", optional: true},
      {:ex_doc, "~> 0.38", only: :docs},
      {:local_thing, path: "../local_thing"},
      {:forked, github: "someone/forked"}
    ]
  end

  defp package do
    [
      maintainers: ["Chris McCord"],
      licenses: ["MIT"]
    ]
  end
end
`;

// Trimmed from phoenixframework/phoenix. One entry per line, the third element
// of the tuple being the version.
const MIX_LOCK = `%{
  "bandit": {:hex, :bandit, "1.12.4", "10bbab488edf8162318d736c19c5837077b8fca2bf5d95b07b33830387124f62", [:mix], [{:hpax, "~> 1.0", [hex: :hpax, repo: "hexpm", optional: false]}], "hexpm", "84513318c5752a2a8017664450f889b47fae5d53d64698ddf1e4fb09a7449e8d"},
  "castore": {:hex, :castore, "1.0.20", "455e48f7115eca98c9f2b0e7a152b5a2e8f2a8a4f964c96e95bd31645ee5fa59", [:mix], [], "hexpm", "940eafbfd8b14bee649f083bc11b3b54ec555b54c3e4ea8213351ff6fee39c10"},
  "forked": {:git, "https://github.com/someone/forked.git", "aabbccddeeff00112233445566778899aabbccdd", [branch: "main"]},
}
`;

// Trimmed from ninenines/cowboy. Both dependencies are git tuples on one line,
// which is what broke a naive comma split.
const REBAR_CONFIG = `{deps, [
{cowlib,".*",{git,"https://github.com/ninenines/cowlib",{tag,"2.19.0"}}},{ranch,".*",{git,"https://github.com/ninenines/ranch",{tag,"1.8.1"}}}
]}.
{erl_opts, [debug_info,warn_export_vars,warn_shadow_vars,warn_obsolete_guard]}.
{project_plugins, [rebar3_hex]}.
`;

const REBAR_CONFIG_HEX = `{deps, [
  jsx,
  {cowboy, "2.12.0"},
  {telemetry, "~> 1.0"}
]}.
`;

// Trimmed from erlang-ls/erlang_ls. The binary-string syntax is the awkward
// part, and the trailing integer is the dependency depth, not a version.
const REBAR_LOCK = `{"1.2.0",
[{<<"bucs">>,{pkg,<<"bucs">>,<<"1.0.16">>},1},
 {<<"docsh">>,{pkg,<<"docsh">>,<<"0.7.2">>},0},
 {<<"getopt">>,{pkg,<<"getopt">>,<<"1.0.1">>},2},
 {<<"from_git">>,{git,"https://github.com/someone/from_git.git",{ref,"aabbcc"}},0}]}.
[
{pkg_hash,[
 {<<"bucs">>, <<"FAKEHASH">>}]}
].
`;

const read = (parser, content, file) =>
    Object.fromEntries(parser.parse(content, file).map(d => [d.name, d.version]));

describe('the ecosystem', () => {
    // Elixir and Erlang share one registry, so one ecosystem covers Mix and
    // Rebar3 — two would never be told apart by a CVE naming a package.
    test('HEX is declared and both parsers produce it', () => {
        expect(Ecosystem.HEX).toBe('HEX');
        expect(hex.parse(MIX_EXS, 'mix.exs').every(d => d.ecosystem === 'HEX')).toBe(true);
        expect(lock.parse(MIX_LOCK, 'mix.lock').every(d => d.ecosystem === 'HEX')).toBe(true);
    });

    test('hex.pm answers about it, so the Dependencies tab can say "are we behind"', () => {
        expect(supportsEcosystem('HEX')).toBe(true);
    });
});

describe('discovery', () => {
    test.each([
        ['mix.exs', 1],
        ['mix.lock', 1],
        ['rebar.config', 1],
        ['rebar.lock', 1],
        ['apps/web/mix.exs', 1],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });

    test('only the lockfiles resolve versions', () => {
        expect(lock.resolvesVersions).toBe(true);
        expect(hex.resolvesVersions).toBeUndefined();
    });
});

describe('mix.exs', () => {
    const deps = read(hex, MIX_EXS, 'mix.exs');

    test('reads a dependency with its constraint', () => {
        expect(deps['plug']).toBe('~> 1.14');
        expect(deps['telemetry']).toBe('~> 0.4 or ~> 1.0');
    });

    test('an optional or docs-only dependency counts', () => {
        expect(deps['phoenix_view']).toBe('~> 2.0');
        expect(deps['ex_doc']).toBe('~> 0.38');
    });

    // path: and github: name a source, and there is nothing on Hex to compare
    // those against.
    test.each(['local_thing', 'forked'])('%s names a source, so its version is unknown', name => {
        expect(deps[name]).toBeNull();
    });

    // The rest of a mix.exs is a project definition full of quoted strings — the
    // application name, the description, the licences — so scanning the whole
    // file would produce rows out of metadata.
    test('only the deps block is read', () => {
        expect(Object.keys(deps).sort()).toEqual([
            'ex_doc',
            'forked',
            'local_thing',
            'phoenix_view',
            'plug',
            'telemetry',
        ]);
    });
});

describe('mix.lock', () => {
    const deps = read(lock, MIX_LOCK, 'mix.lock');

    test('reads a Hex package at its resolved version', () => {
        expect(deps['bandit']).toBe('1.12.4');
        expect(deps['castore']).toBe('1.0.20');
    });

    // The nested list holds each package's own constraints, and those packages
    // have entries of their own.
    test('a nested constraint list is not packages', () => {
        expect(deps).not.toHaveProperty('hpax');
    });

    // A git entry's third element is a revision. Comparing a commit against a
    // release would invent a verdict.
    test('a git entry is a dependency with no comparable version', () => {
        expect(Object.keys(deps)).toContain('forked');
        expect(deps['forked']).toBeNull();
    });
});

describe('rebar.config', () => {
    // cowboy writes both dependencies as git tuples on one line. A naive comma
    // split tore them apart and read `git` and `tag` as two more packages.
    test('a nested git tuple does not become two packages', () => {
        const deps = read(hex, REBAR_CONFIG, 'rebar.config');

        expect(Object.keys(deps).sort()).toEqual(['cowlib', 'ranch']);
    });

    // `.*` means any version: a constraint carrying no information, and the
    // tag inside the git tuple is a revision rather than a Hex release.
    test('a .* constraint is not a version', () => {
        expect(read(hex, REBAR_CONFIG, 'rebar.config')['cowlib']).toBeNull();
    });

    test('a bare atom is a dependency with no constraint', () => {
        expect(read(hex, REBAR_CONFIG_HEX, 'rebar.config')['jsx']).toBeNull();
    });

    test('a name and version pair is read', () => {
        expect(read(hex, REBAR_CONFIG_HEX, 'rebar.config')).toMatchObject({
            cowboy: '2.12.0',
            telemetry: '~> 1.0',
        });
    });

    // erl_opts and project_plugins hold atoms that would otherwise read as
    // packages, so the deps term is found rather than the file scanned.
    test('the other terms in the file are not dependencies', () => {
        const deps = read(hex, REBAR_CONFIG, 'rebar.config');

        expect(deps).not.toHaveProperty('debug_info');
        expect(deps).not.toHaveProperty('rebar3_hex');
    });
});

describe('rebar.lock', () => {
    const deps = read(lock, REBAR_LOCK, 'rebar.lock');

    test('reads a pkg entry through its binary-string syntax', () => {
        expect(deps).toMatchObject({ bucs: '1.0.16', docsh: '0.7.2', getopt: '1.0.1' });
    });

    // The integer after the tuple is the dependency depth: 0 direct, 1 and 2
    // transitive. It is not a version.
    test('the depth integer is not a version', () => {
        expect(Object.values(deps)).not.toContain('0');
        expect(Object.values(deps)).not.toContain('1');
    });

    test('a git entry has no comparable version', () => {
        expect(deps['from_git']).toBeNull();
    });

    // The pkg_hash block at the end repeats every name with its checksum.
    test('the pkg_hash block does not add rows', () => {
        expect(Object.keys(deps)).toHaveLength(4);
    });
});

describe('what must not throw', () => {
    test.each([
        [hex, 'mix.exs', 'defmodule X do\nend\n'],
        [hex, 'mix.exs', ''],
        [hex, 'rebar.config', '{erl_opts, [debug_info]}.\n'],
        [lock, 'mix.lock', '%{}\n'],
        [lock, 'rebar.lock', '{"1.2.0",[]}.\n'],
    ])('%#', (parser, file, content) => {
        expect(parser.parse(content, file)).toEqual([]);
    });
});
