import { parseDependencyList } from './helmParser.js';

/**
 * Parse a Helm Chart.lock.
 *
 * The same `dependencies:` list as Chart.yaml, with every range replaced by the
 * version Helm actually pulled, plus a trailing `digest:` and `generated:` that
 * are not dependencies.
 */
export const manifestFiles = ['Chart.lock'];

// Chart.lock states the version in the chart, so its rows supersede the ranges
// read from Chart.yaml. See reconcileDependencies.js.
export const resolvesVersions = true;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {import('../../domain/entities/Dependency.js').default[]}
 */
export function parse(fileContent, manifestFileName) {
    return parseDependencyList(fileContent, manifestFileName);
}
