import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse a Gradle version catalog (gradle/libs.versions.toml).
 *
 * Modern Android and Kotlin Multiplatform projects declare nothing in the build
 * files — those say `implementation(libs.coroutines.core)` and the coordinates
 * live here. A scanner that only reads build.gradle finds such a project empty
 * and reports it as declaring no dependencies at all, which is exactly wrong.
 *
 * A focused reader rather than a TOML dependency: the catalog format is three
 * known sections of key/value pairs, and the shapes below are the whole of it.
 */

export const manifestFiles = ['libs.versions.toml'];

// Any catalog, whatever it is called: Gradle allows several per project.
const CATALOG_PATH = /(^|\/)gradle\/[^/]*\.versions\.toml$/i;

/** @param {string} filePath */
export function matchesFile(filePath) {
    return CATALOG_PATH.test(filePath) || /(^|\/)libs\.versions\.toml$/i.test(filePath);
}

/** Strip a trailing comment that is not inside a string. */
function withoutComment(line) {
    const hash = line.indexOf('#');
    if (hash === -1) return line;

    const before = line.slice(0, hash);
    // A # inside quotes is part of a value, not a comment.
    const quotes = (before.match(/"/g) ?? []).length;
    return quotes % 2 === 0 ? before : line;
}

/** `key = "value"` and `key = { … }`, split at the first `=`. */
function splitAssignment(line) {
    const separator = line.indexOf('=');
    if (separator === -1) return null;

    return {
        key: line.slice(0, separator).trim(),
        value: line.slice(separator + 1).trim(),
    };
}

/** Read `field = "x"` out of an inline table, including `version.ref`. */
function field(inline, name) {
    const match = inline.match(new RegExp(`${name.replace('.', '\\.')}\\s*=\\s*"([^"]+)"`));
    return match ? match[1] : null;
}

function quoted(value) {
    const match = String(value).match(/^"([^"]*)"$/);
    return match ? match[1] : null;
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const versions = new Map();
    const deps = [];
    const seen = new Set();

    let section = null;

    const add = (ecosystem, name, version) => {
        const key = `${ecosystem}:${name}`;
        if (!name || seen.has(key)) return;
        seen.add(key);

        deps.push(new Dependency({ ecosystem, name, version: version ?? null, manifestFile: manifestFileName }));
    };

    /** A version is either literal, or a reference into [versions]. */
    const resolveVersion = inline => {
        const reference = field(inline, 'version.ref');
        if (reference) return versions.get(reference) ?? null;

        const literal = field(inline, 'version');
        if (literal) return literal;

        // version = { strictly = "1.2" } and friends.
        const strict = inline.match(/version\s*=\s*\{[^}]*"([^"]+)"/);
        return strict ? strict[1] : null;
    };

    for (const rawLine of fileContent.split('\n')) {
        const line = withoutComment(rawLine).trim();
        if (!line) continue;

        const header = line.match(/^\[([^\]]+)\]$/);
        if (header) {
            section = header[1].toLowerCase();
            continue;
        }

        const assignment = splitAssignment(line);
        if (!assignment) continue;

        if (section === 'versions') {
            const value = quoted(assignment.value);
            if (value) versions.set(assignment.key, value);
            continue;
        }

        if (section === 'libraries') {
            // Shorthand: alias = "group:artifact:version"
            const shorthand = quoted(assignment.value);
            if (shorthand) {
                const [group, artifact, version] = shorthand.split(':');
                add('MAVEN', group && artifact ? `${group}:${artifact}` : shorthand, version ?? null);
                continue;
            }

            const module = field(assignment.value, 'module');
            const group = field(assignment.value, 'group');
            const name = field(assignment.value, 'name');
            const coordinates = module ?? (group && name ? `${group}:${name}` : null);

            add('MAVEN', coordinates, resolveVersion(assignment.value));
            continue;
        }

        if (section === 'plugins') {
            const shorthand = quoted(assignment.value);
            if (shorthand) {
                const [id, version] = shorthand.split(':');
                add('GRADLE', id, version ?? null);
                continue;
            }

            add('GRADLE', field(assignment.value, 'id'), resolveVersion(assignment.value));
        }

        // [bundles] only groups aliases already declared above.
    }

    return deps;
}
