import { parse as parseOpam } from './opamParser.js';

/**
 * Parse an opam.locked.
 *
 * The same syntax as an opam file with every constraint pinned to an exact
 * version — `"dune" {= "3.18.2"}` where the opam file said `{>= "3.18"}` — so the
 * reading is identical and only the meaning differs.
 */
export const manifestFiles = ['opam.locked'];

// It states what opam installed, so its rows supersede the opam file's ranges.
// See reconcileDependencies.js.
export const resolvesVersions = true;

/** @param {string} filePath */
export function matchesFile(filePath) {
    // A repository names it after the package, the same way it names the opam
    // file: `lwt.opam.locked` beside `lwt.opam`.
    return filePath.endsWith('.opam.locked');
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {import('../../domain/entities/Dependency.js').default[]}
 */
export function parse(fileContent, manifestFileName) {
    // The opam reader is driven by the depends: and depopts: fields, not by the
    // filename, so it reads this file as it stands.
    return parseOpam(fileContent, manifestFileName);
}
