import { collector } from './conanParser.js';

/**
 * Parse a conan.lock.
 *
 * JSON with `requires`, `build_requires` and `python_requires` arrays of full
 * references: `zlib/1.3.2#revision%timestamp`. The revision and timestamp come
 * off; what is left is the version that was resolved.
 */
export const manifestFiles = ['conan.lock'];

// It states what was resolved, so its rows supersede a conanfile's ranges.
// See reconcileDependencies.js.
export const resolvesVersions = true;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {import('../../domain/entities/Dependency.js').default[]}
 */
export function parse(fileContent, manifestFileName) {
    const out = collector(manifestFileName);

    let document;
    try {
        document = JSON.parse(fileContent);
    } catch {
        return [];
    }

    for (const section of ['requires', 'build_requires', 'python_requires']) {
        for (const reference of document?.[section] ?? []) out.add(reference);
    }

    return out.rows();
}
