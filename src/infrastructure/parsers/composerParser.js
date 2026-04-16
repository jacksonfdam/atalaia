import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse PHP composer.json for dependencies.
 */
export const manifestFiles = ['composer.json'];

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    try {
        const pkg = JSON.parse(fileContent);
        const deps = [];

        for (const section of ['require', 'require-dev']) {
            if (pkg[section] && typeof pkg[section] === 'object') {
                for (const [name, version] of Object.entries(pkg[section])) {
                    // Skip PHP itself and extensions
                    if (name === 'php' || name.startsWith('ext-')) continue;

                    deps.push(new Dependency({
                        ecosystem: 'COMPOSER',
                        name,
                        version: String(version),
                        manifestFile: manifestFileName,
                    }));
                }
            }
        }

        return deps;
    } catch {
        return [];
    }
}
