import Dependency from '../../domain/entities/Dependency.js';
import { normalizePythonName } from './pythonNames.js';

/**
 * Parse a conda-lock.yml.
 *
 * Every entry carries a `manager:` field saying whether conda or pip installed
 * it, which is exactly the split environment.yml has to infer from nesting — so
 * the ecosystem comes straight off the file here.
 */
export const manifestFiles = ['conda-lock.yml'];

// It states the version installed, so its rows supersede environment.yml's.
// See reconcileDependencies.js.
export const resolvesVersions = true;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const rows = [];
    const seen = new Set();
    let current = null;

    function flush() {
        if (current?.name) {
            const ecosystem = current.manager === 'pip' ? 'PIP' : 'CONDA';
            const name = ecosystem === 'PIP' ? normalizePythonName(current.name) : current.name;
            const key = `${ecosystem} ${name}`;

            // The same package appears once per platform — linux-64, osx-arm64,
            // win-64 — so a three-platform lock would otherwise triple every
            // count the console shows.
            if (!seen.has(key)) {
                seen.add(key);
                rows.push(
                    new Dependency({
                        ecosystem,
                        name,
                        version: current.version ?? null,
                        manifestFile: manifestFileName,
                    })
                );
            }
        }

        current = null;
    }

    for (const raw of fileContent.split('\n')) {
        if (!raw.trim()) continue;

        const entry = raw.match(/^\s*-\s+name\s*:\s*(.+)$/);
        if (entry) {
            flush();
            current = { name: unquote(entry[1]), version: null, manager: null };
            continue;
        }

        if (!current) continue;

        const field = raw.match(/^\s+(version|manager)\s*:\s*(.+)$/);
        // Everything else on an entry is its url, hash, category or its own
        // dependencies map, none of which is a package.
        if (field) current[field[1]] = unquote(field[2]);
    }

    flush();
    return rows;
}

/** A conda-lock version is often quoted, because '0.1' would read as a number. */
function unquote(value) {
    return value.trim().replace(/^['"](.*)['"]$/, '$1');
}
