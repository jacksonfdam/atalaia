import { parseEntries } from './carthageParser.js';

/**
 * Parse a Cartfile.resolved.
 *
 * The same entries as a Cartfile with every constraint replaced by what Carthage
 * checked out — a tag, or a commit SHA when a dependency was pinned to a branch.
 */
export const manifestFiles = ['Cartfile.resolved'];

// It states what is in the build, so its rows supersede a Cartfile's constraints.
// See reconcileDependencies.js.
export const resolvesVersions = true;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {import('../../domain/entities/Dependency.js').default[]}
 */
export function parse(fileContent, manifestFileName) {
    return parseEntries(fileContent, manifestFileName);
}
