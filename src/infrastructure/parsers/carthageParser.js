import Dependency from '../../domain/entities/Dependency.js';
import { identityFromUrl } from './swiftManifestParser.js';

/**
 * Parse a Cartfile and a Cartfile.resolved.
 *
 * Carthage is legacy, and that is the argument for reading it: a repository using
 * it has no other dependency file at all, so this is the difference between an
 * empty scan and a real one.
 *
 * The rows are `SWIFT`, not an ecosystem of their own. Carthage resolves against
 * GitHub releases exactly as SPM does, and a CVE naming Alamofire does not care
 * which tool fetched it — so the identity is derived the same way, which also
 * lets #20 reconcile a Carthage row against a Package.resolved one.
 */
export const manifestFiles = ['Cartfile', 'Cartfile.private'];

// github "Quick/Nimble" "v9.2.1", github "Quick/Quick" ~> 4.0,
// binary "https://example.com/thing.json" ~> 1.0, git "https://…" "branch".
const ENTRY = /^(github|git|binary)\s+"([^"]+)"\s*(.*)$/;

// A Carthage revision is a full commit SHA, which is not a version.
const REVISION = /^[0-9a-f]{40}$/i;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parseEntries(fileContent, manifestFileName) {
    const byName = new Map();

    for (const raw of fileContent.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;

        const entry = line.match(ENTRY);
        if (!entry) continue;

        // A `binary` entry points at a JSON specification rather than at a
        // repository, so its last path component carries an extension that is not
        // part of the framework's name.
        const source = entry[1] === 'binary' ? entry[2].replace(/\.json$/i, '') : entry[2];
        const name = identityFromUrl(source);
        if (!name || byName.has(name)) continue;

        byName.set(
            name,
            new Dependency({
                ecosystem: 'SWIFT',
                name,
                version: versionIn(entry[3]),
                manifestFile: manifestFileName,
            })
        );
    }

    return [...byName.values()];
}

/**
 * The version or constraint after a Carthage entry.
 *
 * A resolved file quotes it — `"v9.2.1"` — and a Cartfile does not — `~> 4.0`.
 * ReactiveCocoa's own Cartfile.resolved pins ReactiveSwift to a commit SHA
 * rather than a tag, which is a revision and not something to compare against a
 * release. Tags carry a `v` prefix as often as not, and `v9.2.1` and `9.2.1` are
 * the same release.
 *
 * @param {string} rest
 * @returns {string|null}
 */
function versionIn(rest) {
    const value = rest.trim().replace(/^"(.*)"$/, '$1').trim();
    if (!value) return null;
    if (REVISION.test(value)) return null;

    return value.replace(/^v(?=\d)/, '');
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    return parseEntries(fileContent, manifestFileName);
}
