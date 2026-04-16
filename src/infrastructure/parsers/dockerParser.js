import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Dockerfile and docker-compose.yml for container image dependencies.
 */
export const manifestFiles = ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    if (manifestFileName === 'Dockerfile') {
        return parseDockerfile(fileContent, manifestFileName);
    }
    return parseCompose(fileContent, manifestFileName);
}

function parseDockerfile(content, manifestFileName) {
    const deps = [];
    const seen = new Set();

    for (const line of content.split('\n')) {
        const trimmed = line.trim();

        // Match FROM statements: FROM image:tag [AS name]
        const match = trimmed.match(/^FROM\s+(?:--platform=\S+\s+)?(\S+)/i);
        if (!match) continue;

        const imageRef = match[1];
        if (imageRef === 'scratch') continue;

        const { name, version } = parseImageRef(imageRef);
        const key = `${name}:${version}`;
        if (seen.has(key)) continue;
        seen.add(key);

        deps.push(new Dependency({
            ecosystem: 'DOCKER',
            name,
            version,
            manifestFile: manifestFileName,
        }));
    }

    return deps;
}

function parseCompose(content, manifestFileName) {
    const deps = [];
    const seen = new Set();

    // Simple YAML parsing for image: fields (avoids YAML library dependency for basic cases)
    const imageRegex = /^\s+image:\s*['"]?(\S+?)['"]?\s*$/gm;
    let match;

    while ((match = imageRegex.exec(content)) !== null) {
        const imageRef = match[1];
        const { name, version } = parseImageRef(imageRef);
        const key = `${name}:${version}`;
        if (seen.has(key)) continue;
        seen.add(key);

        deps.push(new Dependency({
            ecosystem: 'DOCKER',
            name,
            version,
            manifestFile: manifestFileName,
        }));
    }

    // Also match build context with dockerfile references
    const buildRegex = /^\s+build:\s*$/gm;

    return deps;
}

/**
 * Parse a Docker image reference into name and version.
 * e.g. "node:24-alpine" → { name: "node", version: "24-alpine" }
 *      "ghcr.io/org/img:v1" → { name: "ghcr.io/org/img", version: "v1" }
 */
function parseImageRef(ref) {
    // Handle digest references
    const digestIdx = ref.indexOf('@');
    if (digestIdx > 0) {
        return { name: ref.substring(0, digestIdx), version: ref.substring(digestIdx + 1) };
    }

    // Handle tag references — but be careful with registry URLs containing colons
    const parts = ref.split(':');
    if (parts.length === 1) {
        return { name: ref, version: 'latest' };
    }

    // Last part after colon is the tag
    const tag = parts.pop();
    const name = parts.join(':');
    return { name, version: tag };
}
