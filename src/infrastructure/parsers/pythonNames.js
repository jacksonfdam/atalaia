/**
 * PEP 503 name normalisation.
 *
 * `typing_extensions`, `typing.extensions` and `Typing-Extensions` are one
 * package, and PyPI serves it as `typing-extensions`. Without this the same
 * dependency arrives twice — a manifest spells it one way and its lockfile the
 * other — and the reconciliation in reconcileDependencies.js cannot tell that
 * the lockfile row supersedes the manifest one.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizePythonName(name) {
    return String(name).toLowerCase().replace(/[-_.]+/g, '-');
}
