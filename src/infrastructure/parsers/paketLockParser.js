import Dependency from '../../domain/entities/Dependency.js';
import { lowerVersion } from './pickVersion.js';

/**
 * Parse a paket.lock.
 *
 * Indented, sectioned, and close in shape to a Gemfile.lock: a package sits at
 * four spaces with its version in brackets, its own dependencies at six with a
 * constraint instead.
 */
export const manifestFiles = ['paket.lock'];

// It states the version restored, so its rows supersede paket.dependencies.
// See reconcileDependencies.js.
export const resolvesVersions = true;

const PACKAGE = /^ {4}(\S+) \(([^)]+)\)/;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const byName = new Map();
    let inNuget = false;

    for (const line of fileContent.split('\n')) {
        if (!line.trim()) continue;

        // Unindented lines are markers: NUGET, GITHUB, GROUP Build, and the
        // STORAGE / CONTENT / RESTRICTION settings. A GROUP starts a whole new
        // set of sections, so this cannot be decided once at the top.
        if (!/^\s/.test(line)) {
            inNuget = line.trim() === 'NUGET';
            continue;
        }

        // A GITHUB section lists single source files at the same indentation —
        // `src/app/FakeLib/Globbing.fs (0341a2e614eb…)` — which would otherwise
        // read as a package at a version that is a commit.
        if (!inNuget) continue;

        const entry = line.match(PACKAGE);
        if (!entry) continue;

        const [, name, version] = entry;
        const existing = byName.get(name);

        if (existing) {
            // A package can appear in more than one GROUP at different versions.
            existing.version = lowerVersion(existing.version, version);
            continue;
        }

        byName.set(
            name,
            new Dependency({
                ecosystem: 'NUGET',
                name,
                version,
                manifestFile: manifestFileName,
            })
        );
    }

    return [...byName.values()];
}
