import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse package.json and package-lock.json for npm/yarn/pnpm dependencies.
 */
export const manifestFiles = ['package.json'];

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    try {
        const pkg = JSON.parse(fileContent);
        const deps = [];

        const sections = [
            'dependencies',
            'devDependencies',
            'peerDependencies',
            'optionalDependencies',
        ];

        for (const section of sections) {
            if (pkg[section] && typeof pkg[section] === 'object') {
                for (const [name, version] of Object.entries(pkg[section])) {
                    deps.push(new Dependency({
                        ecosystem: 'NPM',
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
