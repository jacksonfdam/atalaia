import { describe, test, expect } from '@jest/globals';

const lock = await import('#app/infrastructure/parsers/gemLockParser.js');
const ruby = await import('#app/infrastructure/parsers/rubyParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');

// Trimmed from discourse/discourse, which has four PATH sections and a GEM
// section of three hundred gems, most of them with nested constraint lines.
const GEMFILE_LOCK = `PATH
  remote: gems/plugin_api
  specs:
    plugin_api (0.0.1)

GIT
  remote: https://github.com/someone/forked-gem.git
  revision: aabbccddeeff00112233445566778899aabbccdd
  branch: main
  specs:
    forked-gem (1.2.0)
      rails (>= 7.0)

GEM
  remote: https://rubygems.org/
  specs:
    Ascii85 (2.0.1)
    actionmailer (8.0.5.1)
      actionpack (= 8.0.5.1)
      actionview (= 8.0.5.1)
      activesupport (= 8.0.5.1)
    actionpack (8.0.5.1)
      activesupport (= 8.0.5.1)
    nokogiri (1.18.10-x86_64-linux-gnu)
    rails (8.0.5.1)

PLATFORMS
  ruby
  x86_64-linux

DEPENDENCIES
  actionmailer
  rails (~> 8.0)

CHECKSUMS
  Ascii85 (2.0.1) sha256=fake

RUBY VERSION
   ruby 3.3.6p108

BUNDLED WITH
   2.5.23
`;

// Trimmed from rails/rails, where the version is a local variable.
const RAILS_GEMSPEC = `Gem::Specification.new do |s|
  s.name = "rails"
  s.version = version
  s.summary = "Full-stack web application framework."

  s.add_dependency "activesupport", version
  s.add_dependency "actionpack",    version
  s.add_dependency "bundler",       ">= 1.15.0"
  s.add_development_dependency "rake", "~> 13.0"
  s.add_runtime_dependency "railties", ">= 7.0", "< 9.0"
end
`;

const read = (parser, content, file) =>
    Object.fromEntries(parser.parse(content, file).map(d => [d.name, d.version]));

describe('discovery', () => {
    test.each([
        ['Gemfile.lock', 1],
        ['Gemfile', 1],
        ['rails.gemspec', 1],
        ['gems/thing/thing.gemspec', 1],
        ['fastlane/Pluginfile', 1],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });

    test('only the lockfile claims to resolve versions', () => {
        expect(lock.resolvesVersions).toBe(true);
        expect(ruby.resolvesVersions).toBeUndefined();
    });
});

describe('Gemfile.lock', () => {
    const deps = read(lock, GEMFILE_LOCK, 'Gemfile.lock');

    test('reads a gem at its resolved version', () => {
        expect(deps['rails']).toBe('8.0.5.1');
        expect(deps['Ascii85']).toBe('2.0.1');
    });

    // A gem's own dependencies sit two spaces deeper, with a constraint rather
    // than a version, and each already appears at four spaces with the real one.
    test('a nested constraint line is not a row', () => {
        expect(Object.values(deps).some(version => version?.includes('='))).toBe(false);
        expect(deps['activesupport']).toBeUndefined();
        expect(deps['actionpack']).toBe('8.0.5.1');
    });

    // 1.18.10-x86_64-linux-gnu is the same release as 1.18.10, which is what
    // RubyGems answers about. Ruby spells a prerelease with dots, so a dash in
    // a locked version is always a platform.
    test('a platform suffix comes off', () => {
        expect(deps['nokogiri']).toBe('1.18.10');
    });

    // Its version comes from its own gemspec at whatever revision was checked
    // out, which is not what RubyGems would answer about.
    test('a GIT gem has no comparable version', () => {
        expect(deps).toHaveProperty('forked-gem');
        expect(deps['forked-gem']).toBeNull();
    });

    // A gem being developed in this repository, or an engine in a monorepo.
    test('a PATH gem is not a dependency', () => {
        expect(deps).not.toHaveProperty('plugin_api');
    });

    describe('what is not a gem', () => {
        test('the PLATFORMS list', () => {
            expect(deps).not.toHaveProperty('ruby');
            expect(deps).not.toHaveProperty('x86_64-linux');
        });

        // DEPENDENCIES restates the Gemfile's constraints, without versions.
        test('the DEPENDENCIES list', () => {
            expect(deps['actionmailer']).toBe('8.0.5.1');
            expect(Object.keys(deps)).toHaveLength(6);
        });

        test('CHECKSUMS, RUBY VERSION and BUNDLED WITH', () => {
            expect(Object.keys(deps).sort()).toEqual([
                'Ascii85',
                'actionmailer',
                'actionpack',
                'forked-gem',
                'nokogiri',
                'rails',
            ]);
        });
    });
});

describe('a gemspec', () => {
    const deps = read(ruby, RAILS_GEMSPEC, 'rails.gemspec');

    // A library repository has a gemspec where an application has a Gemfile:
    // rails/rails declares every component it ships here and constrains none
    // of them in a Gemfile.
    test('add_dependency is read', () => {
        expect(deps).toHaveProperty('activesupport');
        expect(deps['bundler']).toBe('>= 1.15.0');
    });

    test('a development dependency counts', () => {
        expect(deps['rake']).toBe('~> 13.0');
    });

    test('several constraints are kept together', () => {
        expect(deps['railties']).toBe('>= 7.0, < 9.0');
    });

    // rails/rails writes `s.add_dependency "activesupport", version` — a local
    // variable. A parser that cannot evaluate Ruby must not store the word
    // "version" as a version.
    test('a variable is not a constraint', () => {
        expect(deps['activesupport']).toBeNull();
        expect(deps['actionpack']).toBeNull();
    });

    test("the gem's own name and version are not a dependency", () => {
        expect(deps).not.toHaveProperty('rails');
        expect(Object.keys(deps).sort()).toEqual([
            'actionpack',
            'activesupport',
            'bundler',
            'railties',
            'rake',
        ]);
    });
});

describe('the Gemfile path still works', () => {
    test('a gem line', () => {
        expect(read(ruby, "gem 'rails', '~> 8.0'\ngem \"puma\"\n", 'Gemfile')).toEqual({
            rails: '~> 8.0',
            puma: null,
        });
    });
});

describe('what must not throw', () => {
    test.each([
        ['an empty lockfile', ''],
        ['a lockfile with no GEM section', 'PLATFORMS\n  ruby\n\nBUNDLED WITH\n   2.5.23\n'],
        ['a GEM section with no specs', 'GEM\n  remote: https://rubygems.org/\n  specs:\n'],
    ])('%s', (_label, content) => {
        expect(lock.parse(content, 'Gemfile.lock')).toEqual([]);
    });

    test('a gemspec that declares nothing', () => {
        expect(ruby.parse('Gem::Specification.new do |s|\n  s.name = "x"\nend\n', 'x.gemspec')).toEqual([]);
    });
});
