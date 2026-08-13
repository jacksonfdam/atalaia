import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse GitHub Actions workflows and composite actions.
 *
 * A pipeline is code that runs with credentials, and it pulls third-party
 * actions and container images by tag — a tag being a moving target that
 * nobody upgrades on purpose. Those are dependencies like any other, and the
 * GitHub Advisory Database publishes advisories for the Actions ecosystem, so
 * they correlate against the same feed.
 *
 * Workflows are YAML, but the values that matter here (`uses:`, `image:`) are
 * plain scalars on their own line, so this stays a line parser rather than
 * pulling in a YAML dependency for two fields.
 */

// Named workflows have arbitrary filenames; composite actions do not.
export const manifestFiles = ['action.yml', 'action.yaml'];

const WORKFLOW_PATH = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i;
const ACTION_PATH = /(^|\/)action\.ya?ml$/i;

/** @param {string} filePath */
export function matchesFile(filePath) {
    return WORKFLOW_PATH.test(filePath) || ACTION_PATH.test(filePath);
}

/**
 * `owner/repo`, `owner/repo/path/to/action` and `owner/repo/path@ref` all
 * resolve to the same advisory subject: the repository.
 */
function normalizeActionName(reference) {
    const [owner, repo] = reference.split('/');
    return owner && repo ? `${owner}/${repo}` : reference;
}

/** `image:tag`, `registry/image:tag`, `image@sha256:…` */
function parseImageRef(imageRef) {
    if (imageRef.includes('@')) {
        const [name, digest] = imageRef.split('@');
        return { name, version: digest };
    }

    const lastColon = imageRef.lastIndexOf(':');
    const lastSlash = imageRef.lastIndexOf('/');

    // A colon before the last slash is a registry port, not a tag.
    if (lastColon > lastSlash) {
        return { name: imageRef.slice(0, lastColon), version: imageRef.slice(lastColon + 1) };
    }

    return { name: imageRef, version: 'latest' };
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];
    const seen = new Set();

    const add = (ecosystem, name, version) => {
        const key = `${ecosystem}:${name}:${version}`;
        if (seen.has(key)) return;
        seen.add(key);

        deps.push(new Dependency({ ecosystem, name, version, manifestFile: manifestFileName }));
    };

    for (const rawLine of fileContent.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('#')) continue;

        const uses = line.match(/^-?\s*uses:\s*['"]?([^'"#\s]+)['"]?/);
        if (uses) {
            const reference = uses[1];

            // A local action lives in this repository: it has no version to
            // track, and its own action.yml is parsed separately.
            if (reference.startsWith('./') || reference.startsWith('../')) continue;

            if (reference.startsWith('docker://')) {
                const { name, version } = parseImageRef(reference.slice('docker://'.length));
                add('DOCKER', name, version);
                continue;
            }

            const [target, ref] = reference.split('@');
            add('GITHUB_ACTIONS', normalizeActionName(target), ref ?? null);
            continue;
        }

        // Job containers and service containers: the CI image is as much a
        // dependency as anything installed inside it.
        const image = line.match(/^-?\s*image:\s*['"]?([^'"#\s]+)['"]?/);
        if (image) {
            const reference = image[1];
            // ${{ … }} expressions resolve at run time; nothing to pin here.
            if (reference.includes('${{')) continue;

            const { name, version } = parseImageRef(reference.replace(/^docker:\/\//, ''));
            add('DOCKER', name, version);
        }
    }

    return deps;
}
