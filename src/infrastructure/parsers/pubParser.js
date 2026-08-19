import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse a Dart or Flutter pubspec.yaml.
 *
 * Constraints only — `pubspec.lock` is what states the resolved version, and
 * pubLockParser.js reads that. A repository that has both keeps the lock's rows
 * and drops these; see reconcileDependencies.js.
 *
 * Read line by line rather than with a YAML parser: the file has a fixed
 * two-space-indent shape and the rest of this directory reads its formats the
 * same way instead of pulling a parser into the tree.
 */
export const manifestFiles = ['pubspec.yaml'];

// Only these two. `environment:` holds the Dart and Flutter SDK bounds, which
// are not packages, and `dependency_overrides:` is a local override of a
// dependency already declared above.
const DEPENDENCY_SECTIONS = new Set(['dependencies', 'dev_dependencies']);

const SECTION = /^([a-z_]+):/;
const ENTRY = /^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];
    let inSection = false;

    for (const line of fileContent.split('\n')) {
        if (!line.trim() || line.trim().startsWith('#')) continue;

        // A section header sits at column zero, and so do the package's own
        // `name:` and `version:` — reading those would file every project as
        // depending on itself.
        if (!/^\s/.test(line)) {
            const section = line.match(SECTION);
            inSection = Boolean(section) && DEPENDENCY_SECTIONS.has(section[1]);
            continue;
        }

        if (!inSection) continue;

        const entry = line.match(ENTRY);
        if (!entry) continue;

        // A bare `http: ^1.2.0` carries its constraint here. An entry with
        // nothing after the colon opens a nested map — `sdk: flutter`, `path:`,
        // `git:` — and none of those name a published version to compare
        // against, so the version is left unknown rather than invented.
        const constraint = entry[2].trim().replace(/^["']|["']$/g, '');

        deps.push(new Dependency({
            ecosystem: 'PUB',
            name: entry[1],
            version: constraint || null,
            manifestFile: manifestFileName,
        }));
    }

    return deps;
}
