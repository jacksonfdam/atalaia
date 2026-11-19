/**
 * Which version to keep when a lockfile holds the same package twice.
 *
 * This is normal, not an edge case: `rust-lang/cargo`'s own lockfile has 23
 * crates at two or three versions each — `bitflags` at 1.3.2 and 2.13.0 — and
 * an npm tree carries the same package at several versions under nested
 * `node_modules` paths. A dependency is unique on
 * (repository_id, ecosystem, name, manifest_file), so one file can only store
 * one row per package and something has to be chosen.
 *
 * **The lowest version wins.** If 1.3.2 is vulnerable and 2.13.0 is patched,
 * keeping the newer one turns a real exposure into a row that reads as clean.
 * Keeping the older one at worst reports something as behind that has a patched
 * copy alongside it, which is a question an operator can answer by looking. The
 * asymmetry is the whole argument: one error is visible, the other is silent.
 */

/**
 * Order two version strings.
 *
 * Segment-wise ordering rather than full semver: enough to say which of two
 * releases of the same package is older, which is all this decides. Numeric
 * segments compare as numbers so 10 sorts after 9; anything else compares as
 * text, which puts `1.0.0-beta` before `1.0.0-rc` and is good enough for a
 * choice between two copies in one build.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a is lower
 */
export function compareVersions(a, b) {
    const left = String(a).split(/[.+-]/);
    const right = String(b).split(/[.+-]/);

    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        const numericLeft = Number.parseInt(left[index], 10);
        const numericRight = Number.parseInt(right[index], 10);

        if (Number.isNaN(numericLeft) || Number.isNaN(numericRight)) {
            const textLeft = left[index] ?? '';
            const textRight = right[index] ?? '';
            if (textLeft !== textRight) return textLeft < textRight ? -1 : 1;
            continue;
        }

        if (numericLeft !== numericRight) return numericLeft - numericRight;
    }

    return 0;
}

/**
 * The version to keep of two.
 *
 * A known version beats an unknown one — an unknown version cannot be compared
 * against a registry, so it says nothing about exposure, while a real one does.
 *
 * @param {string|null} kept
 * @param {string|null} candidate
 * @returns {string|null}
 */
export function lowerVersion(kept, candidate) {
    if (!candidate) return kept;
    if (!kept) return candidate;

    return compareVersions(candidate, kept) < 0 ? candidate : kept;
}

/**
 * Fold another copy of a package into the row already kept for it.
 *
 * `version` stays the lowest, as before — that is the one "how far behind"
 * should read. But a lockfile can hold 4.17.21 beside a vulnerable 5.0.0, and
 * "is any copy vulnerable" has to see both, so every distinct version is kept
 * in `versions` (set only once there is more than one).
 *
 * @param {{ version: string|null, versions?: string[] }} existing  Mutated
 * @param {string|null} candidate
 */
export function keepCopies(existing, candidate) {
    const before = existing.version;
    existing.version = lowerVersion(before, candidate);

    const all = new Set(existing.versions ?? (before ? [before] : []));
    if (candidate) all.add(candidate);

    if (all.size > 1) existing.versions = [...all];
}
