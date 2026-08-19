import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse a Package.swift.
 *
 * A repository that does not commit its `Package.resolved` scans as empty
 * without this, which is common for libraries: an application commits the
 * lockfile, a Swift package often does not.
 *
 * Constraints. swiftParser.js reads the lockfile, and its rows win when both are
 * present.
 */
export const manifestFiles = ['Package.swift'];

// .package(url: "https://github.com/apple/swift-nio.git", from: "2.101.3"),
// and the .package(path: "../local") form.
const PACKAGE_CALL = /\.package\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g;

/**
 * The identity SPM derives for a package: the last path component of its URL,
 * without `.git`, lowercased.
 *
 * It has to match what swiftParser.js produces from `Package.resolved`, or the
 * reconciliation in reconcileDependencies.js cannot tell the manifest row and the
 * lock row apart as the same package.
 *
 * @param {string} url
 * @returns {string}
 */
export function identityFromUrl(url) {
    return url
        .replace(/\.git$/, '')
        .replace(/\/+$/, '')
        .split('/')
        .pop()
        .toLowerCase();
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const byName = new Map();

    for (const call of fileContent.matchAll(PACKAGE_CALL)) {
        const args = call[1];

        const url = args.match(/url\s*:\s*"([^"]+)"/);
        // A path dependency is a directory in this repository. It has no identity
        // on any registry and no CVE can match it.
        if (!url) continue;

        const name = identityFromUrl(url[1]);
        if (!name || byName.has(name)) continue;

        byName.set(
            name,
            new Dependency({
                ecosystem: 'SWIFT',
                name,
                version: constraintIn(args),
                manifestFile: manifestFileName,
            })
        );
    }

    return [...byName.values()];
}

/**
 * The constraint out of a `.package(...)` argument list.
 *
 * `from:`, `exact:` and the range helpers state a version. `branch:` and
 * `revision:` state a source, and there is no published version to compare a
 * branch against.
 *
 * @param {string} args
 * @returns {string|null}
 */
function constraintIn(args) {
    if (/\b(branch|revision)\s*:/.test(args)) return null;

    const exact = args.match(/\bexact\s*:\s*"([^"]+)"/);
    if (exact) return exact[1];

    // from: "2.101.3", and .upToNextMajor(from: "1.0.0") / .upToNextMinor(from:).
    const from = args.match(/\bfrom\s*:\s*"([^"]+)"/);
    if (from) return `from ${from[1]}`;

    // "1.0.0"..<"2.0.0" — a range literal.
    const range = args.match(/"([^"]+)"\s*\.\.[.<]\s*"([^"]+)"/);
    if (range) return `${range[1]} ..< ${range[2]}`;

    return null;
}
