import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse a vcpkg.json.
 *
 * Different from every other manifest here: a vcpkg dependency usually has **no
 * version at all**. Versions come from the registry's baseline commit, not from
 * the manifest, so most rows report unknown with a reason — which is the correct
 * answer rather than a gap.
 *
 * `vcpkg-configuration.json` is on the list of lock files in some documentation
 * and is not one: it holds registry and baseline configuration, no dependencies.
 * Worth saying so, so the next person does not go looking.
 */
export const manifestFiles = ['vcpkg.json'];

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

    const add = entry => {
        // An entry is either a bare name or an object with a `name`.
        const name = typeof entry === 'string' ? entry : entry?.name;
        if (!name || byName.has(name)) return;

        byName.set(
            name,
            new Dependency({
                ecosystem: 'VCPKG',
                name,
                // `version>=` is the only version a manifest can carry, and it is
                // a floor rather than what will be installed — the baseline
                // decides that. Stored because a floor is better than nothing.
                version: typeof entry === 'string' ? null : (entry['version>='] ?? null),
                manifestFile: manifestFileName,
            })
        );
    };

    for (const entry of document?.dependencies ?? []) add(entry);

    // A feature's dependencies are only installed when the feature is enabled,
    // but a repository declaring a feature is a repository that can build it.
    for (const feature of Object.values(document?.features ?? {})) {
        for (const entry of feature?.dependencies ?? []) add(entry);
    }

    return [...byName.values()];
}
