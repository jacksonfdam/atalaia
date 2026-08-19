import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse mix.lock and rebar.lock.
 *
 * Both state the version resolved from Hex, so their rows supersede the
 * constraints in mix.exs and rebar.config. See reconcileDependencies.js.
 */
export const manifestFiles = ['mix.lock', 'rebar.lock'];

export const resolvesVersions = true;

// "bandit": {:hex, :bandit, "1.12.4", "checksum", [:mix], [ … ], "hexpm", …},
// or, for a git dependency,
// "forked": {:git, "https://github.com/o/r.git", "aabbcc…", [branch: "main"]}.
const MIX_NAME = /^"([^"]+)":\s*\{:(\w+)\s*,/;
const MIX_HEX_VERSION = /^"[^"]+":\s*\{:hex,\s*:[\w.]+\s*,\s*"([^"]+)"/;

// {<<"cowlib">>,{pkg,<<"cowlib">>,<<"2.12.1">>},0}, or a git dependency as
// {<<"from_git">>,{git,"https://github.com/o/r.git",{ref,"aabbcc"}},0}.
const REBAR_NAME = /\{<<"([^"]+)">>\s*,/;
const REBAR_PKG_VERSION = /\{pkg\s*,\s*<<"[^"]*">>\s*,\s*<<"([^"]+)">>/;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const byName = new Map();
    const rebar = manifestFileName.split('/').pop() === 'rebar.lock';

    for (const raw of fileContent.split('\n')) {
        const line = raw.trim();
        if (!line) continue;

        const named = line.match(rebar ? REBAR_NAME : MIX_NAME);
        if (!named || byName.has(named[1])) continue;

        // Only a Hex package has a version hex.pm can be asked about. A git
        // dependency is still a dependency — it is somebody else's code in the
        // build — but its revision is a commit, and comparing a commit against a
        // release would invent a verdict.
        const version = line.match(rebar ? REBAR_PKG_VERSION : MIX_HEX_VERSION);

        byName.set(
            named[1],
            new Dependency({
                ecosystem: 'HEX',
                name: named[1],
                version: version?.[1] ?? null,
                manifestFile: manifestFileName,
            })
        );
    }

    return [...byName.values()];
}
