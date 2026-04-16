import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Python dependency files: requirements.txt, Pipfile, pyproject.toml.
 */
export const manifestFiles = ['requirements.txt', 'requirements-dev.txt', 'requirements_dev.txt', 'Pipfile', 'pyproject.toml', 'setup.py', 'setup.cfg'];

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    if (manifestFileName === 'Pipfile') return parsePipfile(fileContent, manifestFileName);
    if (manifestFileName === 'pyproject.toml') return parsePyproject(fileContent, manifestFileName);
    return parseRequirements(fileContent, manifestFileName);
}

function parseRequirements(content, manifestFileName) {
    const deps = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;

        // Match: package==1.0, package>=1.0, package~=1.0, package
        const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*(?:\[.*?\])?\s*([><=!~]+\s*[\d.]+(?:\s*,\s*[><=!~]+\s*[\d.]+)*)?/);
        if (match) {
            deps.push(new Dependency({
                ecosystem: 'PIP',
                name: match[1].toLowerCase(),
                version: match[2] ? match[2].trim() : null,
                manifestFile: manifestFileName,
            }));
        }
    }
    return deps;
}

function parsePipfile(content, manifestFileName) {
    const deps = [];
    let inSection = false;

    for (const line of content.split('\n')) {
        const trimmed = line.trim();

        if (trimmed === '[packages]' || trimmed === '[dev-packages]') {
            inSection = true;
            continue;
        }
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            inSection = false;
            continue;
        }

        if (inSection) {
            const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*=/);
            if (match) {
                // Extract version from the value
                const versionMatch = trimmed.match(/=\s*"([^"]+)"/);
                deps.push(new Dependency({
                    ecosystem: 'PIP',
                    name: match[1].toLowerCase(),
                    version: versionMatch ? versionMatch[1] : null,
                    manifestFile: manifestFileName,
                }));
            }
        }
    }
    return deps;
}

function parsePyproject(content, manifestFileName) {
    const deps = [];

    // Match [project] dependencies array
    const depsMatch = content.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depsMatch) {
        const entries = depsMatch[1].match(/"([^"]+)"/g);
        if (entries) {
            for (const entry of entries) {
                const clean = entry.replace(/"/g, '');
                const match = clean.match(/^([a-zA-Z0-9_.-]+)/);
                if (match) {
                    deps.push(new Dependency({
                        ecosystem: 'PIP',
                        name: match[1].toLowerCase(),
                        version: null,
                        manifestFile: manifestFileName,
                    }));
                }
            }
        }
    }

    return deps;
}
