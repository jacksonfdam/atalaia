import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Rust Cargo.toml for dependencies.
 */
export const manifestFiles = ['Cargo.toml'];

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];
    const sections = ['[dependencies]', '[dev-dependencies]', '[build-dependencies]'];

    let currentSection = null;

    for (const line of fileContent.split('\n')) {
        const trimmed = line.trim();

        // Detect section headers
        if (trimmed.startsWith('[')) {
            currentSection = sections.find(s => trimmed.toLowerCase().startsWith(s.toLowerCase())) || null;
            // Also handle [target.'cfg(...)'.dependencies]
            if (!currentSection && trimmed.toLowerCase().includes('dependencies]')) {
                currentSection = trimmed;
            }
            continue;
        }

        if (!currentSection) continue;
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Simple format: package = "version"
        const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
        if (simpleMatch) {
            deps.push(new Dependency({
                ecosystem: 'CARGO',
                name: simpleMatch[1],
                version: simpleMatch[2],
                manifestFile: manifestFileName,
            }));
            continue;
        }

        // Table format: package = { version = "1.0", features = [...] }
        const tableMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{/);
        if (tableMatch) {
            const versionMatch = trimmed.match(/version\s*=\s*"([^"]+)"/);
            deps.push(new Dependency({
                ecosystem: 'CARGO',
                name: tableMatch[1],
                version: versionMatch ? versionMatch[1] : null,
                manifestFile: manifestFileName,
            }));
        }
    }

    return deps;
}
