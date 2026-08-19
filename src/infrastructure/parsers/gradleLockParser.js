import Dependency from '../../domain/entities/Dependency.js';
import { lowerVersion } from './pickVersion.js';

/**
 * Parse a gradle.lockfile.
 *
 * Written when Gradle dependency locking is enabled, and the only file in a
 * Gradle build that states a version rather than constraining one. Gradle's
 * dynamic versions — `1.+`, `latest.release` — are constraints in the strongest
 * sense: the same build resolves differently on different days.
 */
export const manifestFiles = ['gradle.lockfile'];

// It states what resolved, so its rows supersede build.gradle and the version
// catalog. See reconcileDependencies.js.
export const resolvesVersions = true;

// group:artifact:version=configuration1,configuration2
const MODULE = /^([^:=\s]+):([^:=\s]+):([^=\s]+)=/;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const byName = new Map();

    for (const raw of fileContent.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;

        // `empty=runtimeClasspath,spotbugsPlugins` closes the file and lists the
        // configurations that resolved to nothing. Not a module.
        const module = line.match(MODULE);
        if (!module) continue;

        // group:artifact, matching what gradleCatalogParser.js produces, so the
        // reconciliation in #20 can tell a catalog row and a lock row apart as
        // the same package. That alignment is the reason for the shape.
        const name = `${module[1]}:${module[2]}`;
        const existing = byName.get(name);

        if (existing) {
            existing.version = lowerVersion(existing.version, module[3]);
            continue;
        }

        byName.set(
            name,
            new Dependency({
                ecosystem: 'MAVEN',
                name,
                version: module[3],
                manifestFile: manifestFileName,
            })
        );
    }

    return [...byName.values()];
}
