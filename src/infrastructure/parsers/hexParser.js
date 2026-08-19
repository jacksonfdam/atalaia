import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Elixir and Erlang dependency declarations.
 *
 * Both languages resolve from Hex, so one ecosystem covers Mix and Rebar3 rather
 * than two that a CVE naming a package would never tell apart.
 *
 * Constraints only. mix.lock and rebar.lock state what was resolved, and
 * hexLockParser.js reads those.
 */
export const manifestFiles = ['mix.exs', 'rebar.config'];

// {:plug, "~> 1.14"} and {:phoenix_view, "~> 2.0", optional: true}. A dependency
// with no quoted constraint — {:my_dep, path: "../my_dep"}, {:other, github: "o/r"}
// — has nothing published to compare against.
const MIX_DEPENDENCY = /\{:([a-z][a-z0-9_]*)\s*,\s*(.*)$/;

// Erlang terms: {cowlib, "2.19.0"} or {cowlib, ".*", {git, "...", {tag, "..."}}}.
const REBAR_DEPENDENCY = /\{\s*([a-z][a-z0-9_]*)\s*,\s*(.*)$/;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    return manifestFileName.split('/').pop() === 'rebar.config'
        ? fromRebarConfig(fileContent, manifestFileName)
        : fromMixExs(fileContent, manifestFileName);
}

function row(name, version, manifestFileName) {
    return new Dependency({
        ecosystem: 'HEX',
        name,
        version: version || null,
        manifestFile: manifestFileName,
    });
}

/**
 * mix.exs.
 *
 * Elixir source. The `defp deps do` block holds one tuple per dependency, and
 * the rest of the file is a project definition full of quoted strings — the
 * application name, the description, the licences — so the block has to be
 * found rather than the whole file scanned.
 */
function fromMixExs(content, manifestFileName) {
    const byName = new Map();
    let depth = 0;
    let inDeps = false;

    for (const raw of content.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;

        if (/^defp?\s+deps\b/.test(line)) {
            inDeps = true;
            depth = 0;
            continue;
        }

        if (!inDeps) continue;

        // The block ends at its own `end`, at which point the brackets it opened
        // are closed again.
        if (line === 'end') {
            inDeps = false;
            continue;
        }

        depth += (line.match(/\[/g) ?? []).length - (line.match(/\]/g) ?? []).length;

        const declared = line.match(MIX_DEPENDENCY);
        if (!declared || byName.has(declared[1])) continue;

        // Only a quoted argument is a constraint. `path:`, `github:` and `git:`
        // name a source, and there is nothing on Hex to compare those against.
        const constraint = declared[2].match(/^"([^"]+)"/);

        byName.set(declared[1], row(declared[1], constraint?.[1], manifestFileName));
        if (depth < 0) inDeps = false;
    }

    return [...byName.values()];
}

/**
 * The comma-separated entries of a term list, respecting nesting.
 *
 * Splitting on commas with a regex tears a nested tuple apart: cowboy declares
 * `{cowlib,".*",{git,"https://github.com/ninenines/cowlib",{tag,"2.19.0"}}}`,
 * and a naive split read `git` and `tag` as two more packages.
 *
 * @param {string} list
 * @returns {string[]}
 */
function topLevelEntries(list) {
    const entries = [];
    let depth = 0;
    let quoted = false;
    let start = 0;

    for (let index = 0; index < list.length; index += 1) {
        const character = list[index];

        if (character === '"') quoted = !quoted;
        if (quoted) continue;

        if (character === '{' || character === '[') depth += 1;
        else if (character === '}' || character === ']') depth -= 1;
        else if (character === ',' && depth === 0) {
            entries.push(list.slice(start, index));
            start = index + 1;
        }
    }

    entries.push(list.slice(start));
    return entries;
}

/**
 * rebar.config.
 *
 * Erlang terms. `{deps, [...]}` holds bare atoms, `{name, "1.2.3"}` pairs, and
 * git tuples — cowboy's own file is
 * `{cowlib,".*",{git,"https://github.com/ninenines/cowlib",{tag,"2.19.0"}}}`.
 */
function fromRebarConfig(content, manifestFileName) {
    const byName = new Map();

    // The deps term can be written across lines or all on one, so it is found as
    // a whole rather than line by line. Other terms in the file — erl_opts,
    // profiles, dialyzer — hold atoms that would otherwise read as packages.
    const block = content.match(/\{\s*deps\s*,\s*\[([\s\S]*?)\]\s*\}/);
    if (!block) return [];

    for (const raw of topLevelEntries(block[1])) {
        const entry = raw.trim();
        if (!entry || entry.startsWith('%')) continue;

        const tuple = entry.match(REBAR_DEPENDENCY);
        if (tuple) {
            // `.*` means any version, which is a constraint of no information,
            // and a git tuple's tag is a revision rather than a Hex release.
            const constraint = tuple[2].match(/^"([^"]+)"/);
            const version = constraint && constraint[1] !== '.*' ? constraint[1] : null;

            if (!byName.has(tuple[1])) byName.set(tuple[1], row(tuple[1], version, manifestFileName));
            continue;
        }

        // A bare atom: the newest version, whatever that is.
        const atom = entry.match(/^([a-z][a-z0-9_]*)$/);
        if (atom && !byName.has(atom[1])) byName.set(atom[1], row(atom[1], null, manifestFileName));
    }

    return [...byName.values()];
}
