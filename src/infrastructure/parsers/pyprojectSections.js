/**
 * Which parts of a pyproject.toml declare dependencies.
 *
 * Reading only `[project] dependencies` misses most Python projects: Poetry
 * below 2.0 does not write a `[project]` table at all, `uv` writes PEP 735
 * `[dependency-groups]`, PDM and Hatch each have their own, and extras live in
 * a table of their own. A file can hold several of these at once.
 */

/** Tables whose every array is a list of requirement strings. */
const ARRAY_TABLES = [
    /^project\.optional-dependencies$/, // extras
    /^dependency-groups$/, // PEP 735, what uv writes
    /^tool\.pdm\.dev-dependencies$/,
    /^tool\.uv\.dev-dependencies$/, // pre-PEP-735 uv
];

/** Tables where only one named array is a list of requirements. */
const ARRAY_KEYS = [
    { table: /^project$/, keys: ['dependencies'] },
    // A Hatch environment also has `extra-dependencies`, which are additional
    // requirements rather than a reference to something declared elsewhere.
    { table: /^tool\.hatch\.envs\.[^.]+$/, keys: ['dependencies', 'extra-dependencies'] },
];

/** Tables whose every key is a package and whose value is its constraint. */
const KEY_VALUE_TABLES = [
    /^tool\.poetry\.dependencies$/,
    /^tool\.poetry\.dev-dependencies$/, // Poetry 1.0 style
    /^tool\.poetry\.group\.[^.]+\.dependencies$/,
];

/**
 * Interpreters, not packages. A project constrains the language it runs on in
 * the same table it constrains its dependencies, and filing that as a
 * dependency would send a version lookup to PyPI for the language itself.
 */
const NOT_A_PACKAGE = new Set(['python']);

/** @param {string} table @param {string} key */
export function isRequirementArray(table, key) {
    if (ARRAY_TABLES.some(pattern => pattern.test(table))) return true;
    return ARRAY_KEYS.some(entry => entry.table.test(table) && entry.keys.includes(key));
}

/** @param {string} table */
export function isConstraintTable(table) {
    return KEY_VALUE_TABLES.some(pattern => pattern.test(table));
}

/** @param {string} name */
export function isPackage(name) {
    return !NOT_A_PACKAGE.has(name.toLowerCase());
}
