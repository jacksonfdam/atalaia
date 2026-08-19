import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Conan's dependency files.
 *
 * A reference is `name/version`, so unlike most ecosystems the version is part
 * of the identifier rather than a field beside it.
 */
export const manifestFiles = ['conanfile.txt', 'conanfile.py'];

/** Sections of a conanfile.txt that list references. */
const REQUIRE_SECTIONS = new Set(['requires', 'build_requires', 'tool_requires', 'test_requires']);

/**
 * A `name/version` reference, with the revision and timestamp a lockfile appends
 * cut off: `zlib/1.3.2#1cb806da4901…%1782392402.122708`.
 *
 * @param {string} reference
 * @returns {{ name: string, version: string|null }|null}
 */
export function splitReference(reference) {
    const bare = reference.split('#')[0].trim();
    const slash = bare.indexOf('/');
    if (slash <= 0) return null;

    const version = bare.slice(slash + 1);
    // A version range is a constraint, not a resolution, and `[>=1.2 <2]` is
    // what a conanfile writes when it does not pin.
    return { name: bare.slice(0, slash), version: version.startsWith('[') ? null : version || null };
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    return manifestFileName.split('/').pop() === 'conanfile.py'
        ? fromPython(fileContent, manifestFileName)
        : fromText(fileContent, manifestFileName);
}

export function collector(manifestFileName) {
    const byName = new Map();

    return {
        add(reference) {
            const split = splitReference(reference);
            if (!split || byName.has(split.name)) return;

            byName.set(
                split.name,
                new Dependency({
                    ecosystem: 'CONAN',
                    name: split.name,
                    version: split.version,
                    manifestFile: manifestFileName,
                })
            );
        },
        rows: () => [...byName.values()],
    };
}

/** conanfile.txt: an ini file with a [requires] section. */
function fromText(content, manifestFileName) {
    const out = collector(manifestFileName);
    let inRequires = false;

    for (const raw of content.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;

        const section = line.match(/^\[([^\]]+)\]$/);
        if (section) {
            inRequires = REQUIRE_SECTIONS.has(section[1].trim());
            continue;
        }

        // [generators], [options] and [layout] hold settings, not references.
        if (inRequires) out.add(line);
    }

    return out.rows();
}

/**
 * conanfile.py.
 *
 * Python source, and the requirements can be a class attribute, a
 * `requirements()` method, or computed in a loop. Only the two straightforward
 * forms are read — `self.requires("zlib/1.3.1")` and a `requires = [...]` list.
 * A partial read that says what it read beats executing a build script, and
 * rippled's own conanfile has both forms plus conditionals around them.
 */
function fromPython(content, manifestFileName) {
    const out = collector(manifestFileName);

    // self.requires("zlib/1.3.1", force=True) and self.tool_requires(...).
    for (const call of content.match(/self\.(?:build_|tool_|test_)?requires\(\s*["']([^"']+)["']/g) ?? []) {
        const reference = call.match(/["']([^"']+)["']/);
        if (reference) out.add(reference[1]);
    }

    // requires = [ "zlib/1.3.1", … ] as a class attribute, in any of its four
    // spellings, ending at the closing bracket.
    for (const block of content.match(/^\s*(?:build_|tool_|test_)?requires\s*=\s*\[[\s\S]*?\]/gm) ?? []) {
        for (const quoted of block.match(/["']([^"']+)["']/g) ?? []) out.add(quoted.slice(1, -1));
    }

    return out.rows();
}
