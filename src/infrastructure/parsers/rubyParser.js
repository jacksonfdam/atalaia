import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Ruby Gemfile for gem dependencies.
 *
 * fastlane/Pluginfile is Gemfile syntax under another name — it is how a mobile
 * project declares its release tooling, which is exactly the kind of dependency
 * that goes years without an upgrade.
 */
export const manifestFiles = ['Gemfile', 'Pluginfile'];

/** @param {string} filePath */
export function matchesFile(filePath) {
    return /(^|\/)fastlane\/Pluginfile$/.test(filePath);
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];

    for (const line of fileContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Match: gem 'name', '~> 1.0'  or  gem "name", ">= 2.0"
        const match = trimmed.match(/^gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/);
        if (match) {
            deps.push(new Dependency({
                ecosystem: 'RUBYGEMS',
                name: match[1],
                version: match[2] || null,
                manifestFile: manifestFileName,
            }));
        }
    }

    return deps;
}
