import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Maven pom.xml for dependencies.
 * Uses regex instead of a full XML parser to avoid adding dependencies.
 */
export const manifestFiles = ['pom.xml'];

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];
    const seen = new Set();

    // Match <dependency> blocks
    const depRegex = /<dependency>\s*([\s\S]*?)\s*<\/dependency>/g;
    let match;

    while ((match = depRegex.exec(fileContent)) !== null) {
        const block = match[1];

        const groupId = extractTag(block, 'groupId');
        const artifactId = extractTag(block, 'artifactId');
        const version = extractTag(block, 'version');

        if (!artifactId) continue;

        const name = groupId ? `${groupId}:${artifactId}` : artifactId;
        if (seen.has(name)) continue;
        seen.add(name);

        deps.push(new Dependency({
            ecosystem: 'MAVEN',
            name,
            version: version || null,
            manifestFile: manifestFileName,
        }));
    }

    // Also extract plugins
    const pluginRegex = /<plugin>\s*([\s\S]*?)\s*<\/plugin>/g;
    while ((match = pluginRegex.exec(fileContent)) !== null) {
        const block = match[1];
        const groupId = extractTag(block, 'groupId');
        const artifactId = extractTag(block, 'artifactId');
        const version = extractTag(block, 'version');

        if (!artifactId) continue;

        const name = groupId ? `${groupId}:${artifactId}` : artifactId;
        if (seen.has(name)) continue;
        seen.add(name);

        deps.push(new Dependency({
            ecosystem: 'MAVEN',
            name,
            version: version || null,
            manifestFile: manifestFileName,
        }));
    }

    return deps;
}

function extractTag(xml, tagName) {
    const match = xml.match(new RegExp(`<${tagName}>([^<]+)</${tagName}>`));
    if (!match) return null;
    const value = match[1].trim();
    // Skip Maven properties like ${project.version}
    if (value.startsWith('${')) return null;
    return value;
}
