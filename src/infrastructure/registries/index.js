import axios from 'axios';
import semver from 'semver';
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

/**
 * Maven repositories publish a static maven-metadata.xml per artifact. It is a
 * plain file rather than a search index — faster, and it does not fall over the
 * way search.maven.org does under load.
 */
async function latestFromMavenMetadata(baseUrl, groupId, artifactId) {
    const path = `${groupId.replace(/\./g, '/')}/${artifactId}/maven-metadata.xml`;
    const xml = await get(`${baseUrl}/${path}`, { responseType: 'text' });

    const versions = [...String(xml).matchAll(/<version>([^<]+)<\/version>/g)].map(match => match[1]);

    // Maven's own <release> means "newest that is not a SNAPSHOT", which still
    // includes RCs and alphas — telling someone on the stable line that they
    // are behind because an alpha exists is noise, not news.
    const stable = versions.filter(isStable);
    const newest = highest(stable.length ? stable : versions);
    if (newest) return newest;

    const release = String(xml).match(/<release>([^<]+)<\/release>/);
    return release ? release[1] : null;
}

/**
 * A pre-release qualifier, not a flavour: guava ships 33.4.8-jre and
 * 33.4.8-android, both of which are perfectly stable releases.
 */
function isStable(version) {
    return !/(alpha|beta|-rc|\.rc|-m\d|eap|-dev|preview|snapshot|-cr\d)/i.test(version);
}

/** Maven metadata is ordered by publication, which is not the same as by version. */
function highest(versions) {
    let best = null;
    let bestParsed = null;

    for (const version of versions) {
        const parsed = semver.coerce(version);
        if (!parsed) continue;

        if (!bestParsed || semver.gt(parsed, bestParsed)) {
            best = version;
            bestParsed = parsed;
        }
    }

    return best ?? versions[versions.length - 1] ?? null;
}

const MAVEN_CENTRAL = 'https://repo1.maven.org/maven2';
// Where Gradle plugins and Android's own artifacts actually live.
const PLUGIN_REPOSITORIES = [
    'https://plugins.gradle.org/m2',
    'https://dl.google.com/dl/android/maven2',
    MAVEN_CENTRAL,
];

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

    async HEX(name) {
        const data = await get(`https://hex.pm/api/packages/${encodeURIComponent(name)}`);
        // Newest first. `releases` carries pre-releases too, and `latest_stable_version`
        // is absent on a package that has only ever published one.
        return data?.latest_stable_version ?? data?.releases?.[0]?.version ?? null;
    },

    async PUB(name) {
        const data = await get(`https://pub.dev/api/packages/${encodeURIComponent(name)}`);
        return data?.latest?.version ?? null;
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

        try {
            return await latestFromMavenMetadata(MAVEN_CENTRAL, groupId, artifactId);
        } catch {
            // Not on Central, or Central is having a moment: the search index
            // also covers artifacts mirrored from elsewhere.
            const data = await get('https://search.maven.org/solrsearch/select', {
                params: { q: `g:"${groupId}" AND a:"${artifactId}"`, rows: 1, wt: 'json' },
            });
            return data?.response?.docs?.[0]?.latestVersion ?? null;
        }
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

/**
 * Gradle names two different things: a library, by Maven coordinates, and a
 * plugin, by its id. A plugin is published as a marker artifact whose
 * coordinates are `<id>:<id>.gradle.plugin`, which is what makes it findable.
 */
LOOKUPS.GRADLE = async function gradlePlugin(name) {
    if (name.includes(':')) return LOOKUPS.MAVEN(name);

    // The Android plugins are on Google's repository and never on Central, and
    // most community plugins are on the portal — so all three are tried.
    for (const repository of PLUGIN_REPOSITORIES) {
        try {
            const latest = await latestFromMavenMetadata(repository, name, `${name}.gradle.plugin`);
            if (latest) return latest;
        } catch {
            // Try the next repository.
        }
    }

    return null;
};

/** Ecosystems with no single authoritative registry to ask. */
const UNSUPPORTED = {
    DOCKER: 'Image tags depend on the registry the image comes from.',
    TERRAFORM: 'Providers and modules resolve per registry.',
    HELM: 'Charts resolve per repository.',
    SWIFT: 'A package resolves from its own git repository; there is no central index.',
    // Both registries are git trees of recipe directories rather than services
    // with a per-package endpoint, so there is nothing single to ask.
    CONAN: 'Conan Center is a git tree of recipes with no per-package endpoint.',
    VCPKG: 'Versions come from the registry baseline commit, not from the manifest.',
    // trunk.cocoapods.org could answer this one — the lookup is simply not
    // written yet, which is a different thing from unanswerable.
    COCOAPODS: 'No lookup against trunk.cocoapods.org yet.',
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
