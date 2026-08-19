import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Haskell dependency declarations.
 *
 * Cabal and Stack both resolve against Hackage, so one ecosystem covers them.
 *
 * Constraints. cabal.project.freeze and stack.yaml.lock state what was resolved,
 * and haskellLockParser.js reads those.
 */
export const manifestFiles = ['stack.yaml'];

/** @param {string} filePath */
export function matchesFile(filePath) {
    // A package's description file is named after the package, so there is no
    // fixed filename to match — the same reason nugetParser matches .csproj.
    return filePath.endsWith('.cabal');
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    return manifestFileName.endsWith('.cabal')
        ? fromCabal(fileContent, manifestFileName)
        : fromStackYaml(fileContent, manifestFileName);
}

function collector(manifestFileName) {
    const byName = new Map();

    return {
        add(name, version) {
            if (!name || byName.has(name)) return;

            byName.set(
                name,
                new Dependency({
                    ecosystem: 'HACKAGE',
                    name,
                    version: version || null,
                    manifestFile: manifestFileName,
                })
            );
        },
        rows: () => [...byName.values()],
    };
}

/**
 * A `.cabal` file.
 *
 * `build-depends:` appears once per stanza — library, executable, test-suite —
 * and its list wraps across lines. The rule is indentation: a continuation line
 * is indented deeper than the keyword, and the list ends at the first line that
 * is not. pandoc's own file has a stanza whose next field, `ghc-options:`, sits
 * at exactly the keyword's indent, which is what makes counting spaces the wrong
 * approach and comparing against the keyword's own indent the right one.
 */
function fromCabal(content, manifestFileName) {
    const out = collector(manifestFileName);
    let listIndent = null;

    const addEntries = text => {
        for (const entry of text.split(',')) {
            // `base >= 4.18 && < 5` — the name is the leading token, and the rest
            // is a constraint the entity stores as it stands.
            const declared = entry.trim().match(/^([A-Za-z][\w-]*)\s*(.*)$/);
            if (declared) out.add(declared[1], declared[2].trim());
        }
    };

    for (const raw of content.split('\n')) {
        if (!raw.trim() || raw.trim().startsWith('--')) continue;

        const indent = raw.length - raw.trimStart().length;
        const keyword = raw.trim().match(/^build-depends\s*:\s*(.*)$/i);

        if (keyword) {
            listIndent = indent;
            addEntries(keyword[1]);
            continue;
        }

        if (listIndent === null) continue;

        if (indent > listIndent) addEntries(raw);
        else listIndent = null;
    }

    return out.rows();
}

/**
 * A `stack.yaml`.
 *
 * `resolver:` or `snapshot:` names an LTS set rather than versions, and nothing
 * in the repository resolves it, so it is not read. `extra-deps:` does carry
 * pins, as `name-1.2.3`, and `packages:` lists the local packages of the
 * project itself.
 */
function fromStackYaml(content, manifestFileName) {
    const out = collector(manifestFileName);
    let inExtraDeps = false;

    for (const raw of content.split('\n')) {
        if (!raw.trim() || raw.trim().startsWith('#')) continue;

        // YAML allows a list item at the same indentation as its key, and stack
        // writes them that way — pandoc's stack.yaml has `extra-deps:` and then
        // `- hslua-2.5.0`, both at column zero. A dash opens an item, so only a
        // line that does not is a new section.
        if (!/^\s/.test(raw) && !raw.trimStart().startsWith('-')) {
            inExtraDeps = raw.trim() === 'extra-deps:';
            continue;
        }

        if (!inExtraDeps) continue;

        const entry = raw.trim().match(/^-\s+(\S+)\s*$/);
        // A git or github extra-dep is an object across several lines, and its
        // keys are not a package name.
        if (!entry) continue;

        const split = splitTrailingVersion(entry[1]);
        out.add(split.name, split.version);
    }

    return out.rows();
}

/**
 * Split `hslua-module-doclayout-1.2.1.1` into a name and a version.
 *
 * Hackage names contain dashes, so the split is at the last dash that a digit
 * follows — everything before it is the package.
 *
 * @param {string} pinned
 * @returns {{ name: string, version: string|null }}
 */
export function splitTrailingVersion(pinned) {
    const split = pinned.match(/^(.*?)-(\d[\w.]*)$/);
    return split ? { name: split[1], version: split[2] } : { name: pinned, version: null };
}
