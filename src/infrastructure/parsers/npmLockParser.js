import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse the four npm-family lockfiles.
 *
 * `package.json` declares `^4.17.0`, which does not say whether the installed
 * copy is 4.17.11 — vulnerable to CVE-2021-23337 — or 4.17.21, which is not.
 * The lockfile does, and a repository has exactly one of these.
 *
 * Transitive entries count. Most of an npm tree is transitive and a CVE does
 * not care how a package arrived.
 */
export const manifestFiles = [
    'package-lock.json',
    'npm-shrinkwrap.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
];

// These state the version in the build, so their rows supersede what
// package.json constrained. See reconcileDependencies.js.
export const resolvesVersions = true;

/**
 * A version that is not a published release: a workspace sibling, a symlink, a
 * tarball, a git checkout. There is nothing on the registry to compare it
 * against, so it reports unknown rather than a version that cannot be checked.
 */
const NOT_PUBLISHED = /^(workspace|link|file|portal|patch|git|http|https):/;

/**
 * Split `@scope/name@1.2.3` into its two halves.
 *
 * At the first `@` after the name, not the last: a workspace version is a path
 * and a path can hold a scope. Bun writes `@types/bun@workspace:packages/@types/bun`,
 * and splitting that at the last `@` produces a name and a version that are
 * both nonsense.
 */
function splitAtVersion(spec) {
    // A scope's own leading @ is part of the name, and the name ends at the /.
    const after = spec.startsWith('@') ? spec.indexOf('/') : 0;
    const at = spec.indexOf('@', after + 1);
    if (at <= 0) return { name: spec, version: null };
    return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

/** The version as stored: a real release, or nothing. */
function published(version) {
    if (!version) return null;
    // pnpm appends the peers a package resolved against: 1.0.0(react@18.3.1).
    const bare = version.split('(')[0].trim();
    return !bare || NOT_PUBLISHED.test(bare) ? null : bare;
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const file = manifestFileName.split('/').pop();

    if (file === 'pnpm-lock.yaml') return fromPnpm(fileContent, manifestFileName);
    if (file === 'yarn.lock') return fromYarn(fileContent, manifestFileName);
    if (file === 'bun.lock') return fromBun(fileContent, manifestFileName);
    return fromNpm(fileContent, manifestFileName);
}

/** One row per name, first version seen. */
function collector(manifestFileName) {
    const byName = new Map();

    return {
        add(name, version) {
            if (!name || byName.has(name)) return;

            byName.set(
                name,
                new Dependency({
                    ecosystem: 'NPM',
                    name,
                    version: published(version),
                    manifestFile: manifestFileName,
                })
            );
        },
        rows: () => [...byName.values()],
    };
}

/**
 * package-lock.json and npm-shrinkwrap.json.
 *
 * Version 2 and 3 key `packages` by install path; version 1 nests `dependencies`
 * by name. A version 2 file carries both, and `packages` is the better of the
 * two because it states the real tree rather than a deduplicated view of it.
 */
function fromNpm(content, manifestFileName) {
    const out = collector(manifestFileName);

    let document;
    try {
        document = JSON.parse(content);
    } catch {
        return [];
    }

    if (document?.packages) {
        for (const [path, entry] of Object.entries(document.packages)) {
            // '' is the project itself. A path with no node_modules/ segment is
            // a workspace package in the repository, and `link: true` is the
            // symlink pointing at one — neither is a dependency to advise about.
            if (!path.includes('node_modules/') || entry?.link) continue;

            out.add(path.split('node_modules/').pop(), entry?.version);
        }

        if (out.rows().length > 0) return out.rows();
    }

    // Version 1, or a version 2 whose packages map held only workspaces.
    const walk = tree => {
        for (const [name, entry] of Object.entries(tree ?? {})) {
            out.add(name, entry?.version);
            walk(entry?.dependencies);
        }
    };
    walk(document?.dependencies);

    return out.rows();
}

/**
 * pnpm-lock.yaml.
 *
 * The `packages:` keys are the identity: `'@scope/name@1.2.3':` in version 6
 * and later, `/name/1.2.3:` before that. `importers:` above it lists the
 * workspace's own constraints, and `snapshots:` below repeats the same packages
 * with their resolved peers — reading either would duplicate every row.
 */
function fromPnpm(content, manifestFileName) {
    const out = collector(manifestFileName);
    let inPackages = false;

    for (const line of content.split('\n')) {
        if (!line.trim() || line.trim().startsWith('#')) continue;

        if (!/^\s/.test(line)) {
            inPackages = line.trim() === 'packages:';
            continue;
        }

        if (!inPackages) continue;

        // A key at two spaces; anything deeper is `resolution:` or `engines:`.
        const key = line.match(/^ {2}'?([^'\s][^':]*)'?:\s*$/);
        if (!key) continue;

        const spec = key[1].replace(/^\//, '');
        // Version 5 separated name and version with a slash rather than an @.
        const legacy = spec.match(/^(@?[^@]+)\/(\d[^/]*)$/);
        const { name, version } = legacy
            ? { name: legacy[1], version: legacy[2] }
            : splitAtVersion(spec);

        out.add(name, version);
    }

    return out.rows();
}

/**
 * yarn.lock, both dialects.
 *
 * Classic quotes the version — `version "4.17.21"` — and Berry does not
 * — `version: 4.17.21`. A header can carry several specifiers for one resolved
 * package, comma separated; they are one row.
 */
function fromYarn(content, manifestFileName) {
    const out = collector(manifestFileName);
    let pending = null;

    for (const line of content.split('\n')) {
        if (!line.trim() || line.trim().startsWith('#')) continue;

        if (!/^\s/.test(line)) {
            const header = line.match(/^"?([^",]+)"?/);
            if (!header) continue;

            // `lodash@^4.17.0` in classic, `lodash@npm:^4.17.0` in Berry, and
            // `@babel/core@^7.26.0` in both. Several specifiers can share one
            // resolved package, comma separated; the first names it.
            pending = splitAtVersion(header[1].replace(/^"|"$/g, ''));
            continue;
        }

        if (!pending) continue;

        const version = line.match(/^\s+version:?\s+"?([^"\s]+)"?\s*$/);
        if (version) {
            // `local-thing@file:../local-thing` does carry a version, but it is
            // the one in that directory's package.json — nothing the registry
            // can be asked about, and a package of the same name published
            // there would produce a verdict about something else entirely.
            const resolved = NOT_PUBLISHED.test(pending.version ?? '') ? null : version[1];

            out.add(pending.name, resolved);
            pending = null;
        }
    }

    return out.rows();
}

/**
 * bun.lock.
 *
 * Read line by line rather than parsed: the format is JSONC, and every entry is
 * on one line, so a scrubber for comments and trailing commas would be more
 * code than the read itself. `bun.lockb`, the binary format, cannot be read at
 * all — see docs/repositories.md.
 */
function fromBun(content, manifestFileName) {
    const out = collector(manifestFileName);
    let inPackages = false;

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (/^"packages"\s*:\s*\{/.test(trimmed)) {
            inPackages = true;
            continue;
        }
        // The packages object is the last one, closed at two spaces.
        if (inPackages && /^\}/.test(line.slice(2))) break;

        if (!inPackages) continue;

        // "esbuild": ["esbuild@0.21.5", "", { … }, "sha512-…"],
        const entry = trimmed.match(/^"([^"]+)"\s*:\s*\[\s*"([^"]+)"/);
        if (!entry) continue;

        const { name, version } = splitAtVersion(entry[2]);
        out.add(name || entry[1], version);
    }

    return out.rows();
}
