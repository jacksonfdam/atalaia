import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Ruby dependency declarations: a Gemfile, and a gem's own gemspec.
 *
 * fastlane/Pluginfile is Gemfile syntax under another name — it is how a mobile
 * project declares its release tooling, which is exactly the kind of dependency
 * that goes years without an upgrade.
 *
 * A gemspec matters because a library repository has one where an application
 * has a Gemfile: rails/rails declares every component it ships in rails.gemspec
 * and has no Gemfile constraint for any of them.
 */
export const manifestFiles = ['Gemfile', 'Pluginfile'];

/** @param {string} filePath */
export function matchesFile(filePath) {
    return /(^|\/)fastlane\/Pluginfile$/.test(filePath) || filePath.endsWith('.gemspec');
}

// add_dependency, add_runtime_dependency and add_development_dependency. The
// third runs in CI and in a developer's container, which is still exposure.
const GEMSPEC_DEPENDENCY = /add(?:_runtime|_development)?_dependency\s*\(?\s*['"]([^'"]+)['"](.*)$/;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];
    const gemspec = manifestFileName.endsWith('.gemspec');

    for (const line of fileContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        if (gemspec) {
            const declared = trimmed.match(GEMSPEC_DEPENDENCY);
            if (declared) {
                deps.push(new Dependency({
                    ecosystem: 'RUBYGEMS',
                    name: declared[1],
                    version: constraintsIn(declared[2]),
                    manifestFile: manifestFileName,
                }));
            }
            continue;
        }

        // Match: gem 'name', '~> 1.0'  or  gem "name", ">= 2.0"
        const match = trimmed.match(/^gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/);
        if (match) {
            deps.push(new Dependency({
                ecosystem: 'RUBYGEMS',
                name: match[1],
                version: match[2] || null,
                manifestFile: manifestFileName,
            }));
        }
    }

    return deps;
}

/**
 * The constraints after a gemspec dependency's name.
 *
 * A gemspec is Ruby, and rails/rails writes `s.add_dependency "activesupport",
 * version` — a local variable, not a literal. Only quoted arguments are a
 * constraint; anything else is code this parser cannot evaluate and must not
 * pretend to, so the version reports unknown.
 *
 * @param {string} rest
 * @returns {string|null}
 */
function constraintsIn(rest) {
    const quoted = (rest.match(/['"]([^'"]+)['"]/g) ?? []).map(value => value.slice(1, -1));
    return quoted.length ? quoted.join(', ') : null;
}
