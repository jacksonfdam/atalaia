import Dependency from '../../domain/entities/Dependency.js';
import { lowerVersion } from './pickVersion.js';

/**
 * Parse a Cargo.lock.
 *
 * Cargo.toml declares `serde = "1.0"`, which resolves to anything from 1.0.0 to
 * the newest 1.x. The lock says which, and Rust binaries commit it by
 * convention.
 */
export const manifestFiles = ['Cargo.lock'];

// It states the version compiled in, so its rows supersede Cargo.toml's
// constraints. See reconcileDependencies.js.
export const resolvesVersions = true;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const byName = new Map();
    let current = null;

    function flush() {
        // A crate with no `source` is a member of this workspace: it is the
        // repository's own code, so no CVE can match it and crates.io has
        // nothing to say about it. rust-lang/cargo has 27 of them.
        if (current?.name && current.source) {
            // `git+https://…` is a real dependency at a revision rather than a
            // release, so the version it carries is the crate's own and not
            // something crates.io can be asked about.
            const version = current.source.startsWith('registry+') ? current.version : null;
            const existing = byName.get(current.name);

            if (existing) {
                // A crate at two versions is ordinary in Rust — 23 of them in
                // cargo's own lockfile. See pickVersion.js for why the lower
                // one is the row worth keeping.
                existing.version = lowerVersion(existing.version, version);
            } else {
                byName.set(
                    current.name,
                    new Dependency({
                        ecosystem: 'CARGO',
                        name: current.name,
                        version,
                        manifestFile: manifestFileName,
                    })
                );
            }
        }
        current = null;
    }

    for (const raw of fileContent.split('\n')) {
        const line = raw.trimEnd();
        if (!line.trim() || line.trim().startsWith('#')) continue;

        const header = line.match(/^\[+([^\]]+)\]+/);
        if (header) {
            flush();
            // [[package]] is the only table that matters; the file also has a
            // top-level `version` key and, in older lockfiles, [metadata].
            if (header[1].trim() === 'package') current = { name: null, version: null, source: null };
            continue;
        }

        if (!current) continue;

        // Unindented keys only. A crate's `dependencies` list is an array of
        // indented strings naming crates that each have a [[package]] of their
        // own, and reading those would double every row.
        const field = line.match(/^(name|version|source)\s*=\s*"([^"]*)"/);
        if (field) current[field[1]] = field[2];
    }

    flush();
    return [...byName.values()];
}
