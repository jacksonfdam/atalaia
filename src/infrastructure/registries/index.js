import axios from 'axios';
import logger from '../logger.js';

/**
 * Latest published version of a package, per ecosystem.
 *
 * Every lookup is a single read against the ecosystem's own registry — the same
 * place a developer would look. Nothing is written anywhere, and a registry
 * that is down or rate-limiting fails that one dependency instead of the check.
 *
 * @typedef {(name: string) => Promise<string|null>} VersionLookup
 */

const TIMEOUT_MS = parseInt(process.env.REGISTRY_TIMEOUT_MS, 10) || 10_000;
const HEADERS = { 'User-Agent': 'Atalaia/1.0 (dependency-freshness)' };

async function get(url, options = {}) {
    const { data } = await axios.get(url, { timeout: TIMEOUT_MS, headers: HEADERS, ...options });
    return data;
}

/** Maven coordinates arrive as `groupId:artifactId`. */
function splitMavenCoordinates(name) {
    const [groupId, artifactId] = name.split(':');
    return { groupId, artifactId };
}

/** @type {Record<string, VersionLookup>} */
const LOOKUPS = {
    async NPM(name) {
        // The abbreviated document is a fraction of the full one and still
        // carries dist-tags.
        const data = await get(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
            headers: { ...HEADERS, Accept: 'application/vnd.npm.install-v1+json' },
        });
        return data?.['dist-tags']?.latest ?? null;
    },

    async PIP(name) {
        const data = await get(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
        return data?.info?.version ?? null;
    },

    async CARGO(name) {
        const data = await get(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
        return data?.crate?.max_stable_version ?? data?.crate?.newest_version ?? null;
    },

    async RUBYGEMS(name) {
        const data = await get(`https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`);
        return data?.version ?? null;
    },

    async COMPOSER(name) {
        const data = await get(`https://repo.packagist.org/p2/${name}.json`);
        const versions = data?.packages?.[name] ?? [];
        // Newest first, pre-releases included; the first stable one wins.
        const stable = versions.find(entry => !/(dev|alpha|beta|rc)/i.test(entry.version));
        return (stable ?? versions[0])?.version ?? null;
    },

    async NUGET(name) {
        const data = await get(`https://api.nuget.org/v3-flatcontainer/${name.toLowerCase()}/index.json`);
        const versions = (data?.versions ?? []).filter(version => !/-/.test(version));
        return versions.length ? versions[versions.length - 1] : (data?.versions?.at(-1) ?? null);
    },

    async GO(name) {
        // @latest, not @v/list: the list is unordered, so its last line is not
        // the newest version — it just happened to be published last.
        const data = await get(`https://proxy.golang.org/${name.toLowerCase()}/@latest`);
        return data?.Version ?? null;
    },

    async MAVEN(name) {
        const { groupId, artifactId } = splitMavenCoordinates(name);
        if (!groupId || !artifactId) return null;

        const data = await get('https://search.maven.org/solrsearch/select', {
            params: { q: `g:"${groupId}" AND a:"${artifactId}"`, rows: 1, wt: 'json' },
        });
        return data?.response?.docs?.[0]?.latestVersion ?? null;
    },

    async GITHUB_ACTIONS(name) {
        // An action is a repository: its releases are its versions. The token is
        // optional but keeps the rate limit workable.
        const token = process.env.GITHUB_TOKEN;
        const data = await get(`https://api.github.com/repos/${name}/releases/latest`, {
            headers: {
                ...HEADERS,
                Accept: 'application/vnd.github+json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        });
        return data?.tag_name ?? null;
    },
};

// Gradle declares Maven coordinates and resolves them from the same repository.
LOOKUPS.GRADLE = LOOKUPS.MAVEN;

/** Ecosystems with no single authoritative registry to ask. */
const UNSUPPORTED = {
    DOCKER: 'Image tags depend on the registry the image comes from.',
    TERRAFORM: 'Providers and modules resolve per registry.',
    HELM: 'Charts resolve per repository.',
    UNKNOWN: 'Unrecognised ecosystem.',
};

/** @param {string} ecosystem */
export function supportsEcosystem(ecosystem) {
    return Boolean(LOOKUPS[ecosystem]);
}

/** @param {string} ecosystem */
export function unsupportedReason(ecosystem) {
    return UNSUPPORTED[ecosystem] ?? 'No registry lookup implemented for this ecosystem.';
}

/**
 * @param {string} ecosystem
 * @param {string} name
 * @returns {Promise<{ latest: string|null, error: string|null }>}
 */
export async function fetchLatestVersion(ecosystem, name) {
    const lookup = LOOKUPS[ecosystem];
    if (!lookup) return { latest: null, error: unsupportedReason(ecosystem) };

    try {
        return { latest: await lookup(name), error: null };
    } catch (err) {
        // 404 is an answer, not a failure: the package is not on that registry
        // under that name, which is worth showing as such.
        const status = err.response?.status;
        const message = status === 404 ? 'Not found on the registry' : err.message;

        logger.debug({ ecosystem, name, err: message }, 'Version lookup failed');
        return { latest: null, error: message };
    }
}
