import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse a Gemfile.lock.
 *
 * A Gemfile declares `~> 6.1`; the lock says 6.1.7.6. Ruby projects commit it
 * almost without exception.
 */
export const manifestFiles = ['Gemfile.lock'];

// It states the version installed, so its rows supersede the Gemfile's
// constraints. See reconcileDependencies.js.
export const resolvesVersions = true;

// A gem sits at four spaces with its version in brackets; its own dependencies
// sit at six with a constraint instead. Taking both would list every gem twice
// — once resolved and once constrained — and inflate every count the console
// shows. Same trap as cocoapodsParser.js, which is worth reading first.
const GEM = /^ {4}([A-Za-z0-9._-]+) \(([^)]+)\)\s*$/;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const byName = new Map();
    let section = null;

    for (const line of fileContent.split('\n')) {
        if (!line.trim()) continue;

        // Section headers are unindented and capitalised: GEM, PATH, GIT,
        // PLATFORMS, DEPENDENCIES, CHECKSUMS, RUBY VERSION, BUNDLED WITH.
        if (!/^\s/.test(line)) {
            section = line.trim();
            continue;
        }

        // PATH is code in this repository — a gem being developed here, or an
        // engine in a monorepo. No CVE can match it, so it is not a dependency.
        if (section !== 'GEM' && section !== 'GIT') continue;

        const gem = line.match(GEM);
        if (!gem) continue;

        const [, name, version] = gem;
        if (byName.has(name)) continue;

        byName.set(
            name,
            new Dependency({
                ecosystem: 'RUBYGEMS',
                name,
                // A GIT gem's version comes from its own gemspec at whatever
                // revision was checked out, which is not what RubyGems would
                // answer about — the revision is recorded, not the release.
                version: section === 'GIT' ? null : published(version),
                manifestFile: manifestFileName,
            })
        );
    }

    return [...byName.values()];
}

/**
 * The version as stored.
 *
 * A platform-specific gem is recorded as `1.16.0-x86_64-linux`. That is the
 * same release as `1.16.0`, which is what RubyGems answers about, and it is
 * safe to cut at the dash: Ruby spells a prerelease with dots — `1.0.0.beta1`
 * — so a dash in a locked version is always a platform.
 */
function published(version) {
    return version.split('-')[0];
}
