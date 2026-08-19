import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse a LuaRocks rockspec.
 *
 * There are no lockfiles in LuaRocks, so every row here is a constraint.
 */
export const manifestFiles = [];

/** @param {string} filePath */
export function matchesFile(filePath) {
    // The filename carries the package and its version — `penlight-1.14.0-1.rockspec`
    // — so there is no fixed name to match.
    return filePath.endsWith('.rockspec');
}

/** The interpreter, not a package, the same way `ocaml` is under opam. */
const NOT_A_PACKAGE = new Set(['lua']);

const TABLES = ['dependencies', 'build_dependencies', 'test_dependencies'];

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const byName = new Map();

    for (const table of TABLES) {
        // A rockspec is a Lua program, so `dependencies` could in principle be
        // computed. Only the literal table form is read — the same limit
        // conanParser puts on conanfile.py — and Penlight's own rockspec, which
        // builds its version out of local variables, still writes this one
        // literally.
        const block = fileContent.match(new RegExp(`^\\s*${table}\\s*=\\s*\\{([\\s\\S]*?)\\}`, 'm'));
        if (!block) continue;

        for (const quoted of block[1].matchAll(/["']([^"']+)["']/g)) {
            // `luafilesystem >= 1.6.3` — the name is the leading token and the
            // rest is a constraint.
            const declared = quoted[1].trim().match(/^([A-Za-z][\w.-]*)\s*(.*)$/);
            if (!declared) continue;

            const name = declared[1];
            if (NOT_A_PACKAGE.has(name.toLowerCase()) || byName.has(name)) continue;

            byName.set(
                name,
                new Dependency({
                    ecosystem: 'LUAROCKS',
                    name,
                    version: declared[2].trim() || null,
                    manifestFile: manifestFileName,
                })
            );
        }
    }

    return [...byName.values()];
}
