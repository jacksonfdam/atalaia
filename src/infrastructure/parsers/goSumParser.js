import Dependency from '../../domain/entities/Dependency.js';
import { lowerVersion } from './pickVersion.js';

/**
 * Parse a go.sum.
 *
 * go.mod names the direct dependencies, so Go starts out better off than most
 * ecosystems here. What it misses is the rest of the build graph: in Go a
 * transitive module is compiled into the binary exactly like a direct one, so a
 * CVE in one is the same exposure. go.sum lists all of them.
 */
export const manifestFiles = ['go.sum'];

// It states which version of each module is in the build, so its rows supersede
// go.mod's requires. See reconcileDependencies.js.
export const resolvesVersions = true;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const byName = new Map();

    for (const line of fileContent.split('\n')) {
        const [path, version] = line.trim().split(/\s+/);
        if (!path || !version) continue;

        // Two lines per module: one for its content and one for its go.mod. A
        // module with only the second was consulted to resolve versions and its
        // source was never downloaded, so nothing of it is in the binary and a
        // CVE against it is not exposure. Both a deduplication and the right
        // filter, which is why it is not just a matter of skipping a suffix.
        if (version.endsWith('/go.mod')) continue;

        const existing = byName.get(path);
        if (existing) {
            // The same module appears once per version in the graph. See
            // pickVersion.js for why the lower one is the row worth keeping.
            existing.version = lowerVersion(existing.version, version);
            continue;
        }

        byName.set(
            path,
            new Dependency({
                ecosystem: 'GO',
                name: path,
                // A pseudo-version — v0.0.0-20250425153114-8976f5be98c1 — is a
                // real, comparable version to the Go proxy, and so is a
                // +incompatible suffix. Neither is reported unknown.
                version,
                manifestFile: manifestFileName,
            })
        );
    }

    return [...byName.values()];
}
