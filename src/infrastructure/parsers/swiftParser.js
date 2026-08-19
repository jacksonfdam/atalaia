import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Swift Package Manager's Package.resolved.
 *
 * The lockfile rather than Package.swift: the manifest declares ranges, the
 * lockfile says which version is actually in the build.
 */
export const manifestFiles = ['Package.resolved'];

/**
 * Version 1 nests the pins under `object` and names a pin by its repository
 * name; version 2 and 3 hoist them and name it by identity. Both are still in
 * the wild — Xcode writes 2 or 3, older checked-in files are 1.
 *
 * @param {object} document
 * @returns {object[]}
 */
function pinsOf(document) {
    if (Array.isArray(document?.pins)) return document.pins;
    if (Array.isArray(document?.object?.pins)) return document.object.pins;
    return [];
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    let document;
    try {
        document = JSON.parse(fileContent);
    } catch {
        return [];
    }

    const deps = [];

    for (const pin of pinsOf(document)) {
        const name = pin?.identity || pin?.package;
        if (!name) continue;

        deps.push(new Dependency({
            ecosystem: 'SWIFT',
            name,
            // A pin on a branch or a bare revision has no version, and the
            // revision hash is not one — reporting it unknown is the answer.
            version: pin?.state?.version ?? null,
            manifestFile: manifestFileName,
        }));
    }

    return deps;
}
