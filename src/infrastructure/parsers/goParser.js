import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Go module files (go.mod).
 */
export const manifestFiles = ['go.mod'];

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];

    // Match require block: require ( ... )
    const requireBlock = fileContent.match(/require\s*\(([\s\S]*?)\)/g);
    if (requireBlock) {
        for (const block of requireBlock) {
            const inner = block.replace(/require\s*\(/, '').replace(/\)$/, '');
            for (const line of inner.split('\n')) {
                const dep = parseRequireLine(line, manifestFileName);
                if (dep) deps.push(dep);
            }
        }
    }

    // Match single-line require: require github.com/pkg v1.0.0
    for (const line of fileContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('require ') && !trimmed.includes('(')) {
            const dep = parseRequireLine(trimmed.replace(/^require\s+/, ''), manifestFileName);
            if (dep) deps.push(dep);
        }
    }

    return deps;
}

function parseRequireLine(line, manifestFileName) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith(')')) return null;

    // Module path and version: github.com/pkg/errors v0.9.1
    const match = trimmed.match(/^(\S+)\s+(v[\d.]+\S*)/);
    if (!match) return null;

    // Extract the short name from the module path
    const parts = match[1].split('/');
    const name = parts[parts.length - 1];

    return new Dependency({
        ecosystem: 'GO',
        name: match[1], // Full module path as name
        version: match[2],
        manifestFile: manifestFileName,
    });
}
