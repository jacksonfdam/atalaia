import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse a composer.lock.
 *
 * composer.json declares `^8.2`; the lock says 8.2.14. Only the second can be
 * matched against a CVE, and PHP projects commit it as a rule.
 */
export const manifestFiles = ['composer.lock'];

// It states the version installed, so its rows supersede composer.json's
// constraints. See reconcileDependencies.js.
export const resolvesVersions = true;

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

    const byName = new Map();

    // Both lists: a dev dependency runs in CI and in a developer's container,
    // and that is still exposure.
    for (const section of ['packages', 'packages-dev']) {
        for (const entry of document?.[section] ?? []) {
            const name = entry?.name;
            if (!name || byName.has(name)) continue;

            byName.set(
                name,
                new Dependency({
                    ecosystem: 'COMPOSER',
                    name,
                    version: published(entry.version),
                    manifestFile: manifestFileName,
                })
            );
        }
    }

    return [...byName.values()];
}

/**
 * The version as stored.
 *
 * Composer writes a `v` prefix as often as not — 94 of the 153 packages in
 * composer/composer's own lockfile have one — and `v8.2.14` and `8.2.14` are
 * the same release. Storing both spellings makes one package look like two and
 * makes the comparison against Packagist fail on the prefixed half.
 *
 * `dev-main` is a branch install, not a version. Every entry's `source.type` is
 * `git`, because that is how Packagist serves everything, so the source says
 * nothing here — the `dev-` prefix is what distinguishes a branch.
 */
function published(version) {
    if (!version) return null;
    if (version.startsWith('dev-')) return null;

    return version.replace(/^v(?=\d)/, '');
}
