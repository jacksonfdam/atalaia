import Dependency from '../../domain/entities/Dependency.js';
import { normalizePythonName } from './pythonNames.js';

/**
 * Parse the four Python lockfiles.
 *
 * A pyproject.toml says `>=4.2`; the lockfile says 4.2.7, which is the only
 * version a CVE can be matched against.
 *
 * Poetry, uv and PDM all write TOML arrays of `[[package]]` tables, so one
 * reader covers three of them. Pipenv writes JSON and needs its own.
 */
export const manifestFiles = ['poetry.lock', 'uv.lock', 'pdm.lock', 'Pipfile.lock'];

// These state the version installed, so their rows supersede whatever
// requirements.txt or pyproject.toml constrained. See reconcileDependencies.js.
export const resolvesVersions = true;

/**
 * Sources that are code in the repository rather than a dependency on someone
 * else's package: the project itself, a workspace sibling, a local path.
 * Filing those would put rows in the table that no CVE can match.
 */
const LOCAL_SOURCE = /\b(editable|virtual|directory|path)\s*=/;

/** Sources that are a real third-party dependency with no published version. */
const REMOTE_UNVERSIONED = /\b(git|url)\s*=/;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const file = manifestFileName.split('/').pop();

    return file === 'Pipfile.lock'
        ? fromPipenv(fileContent, manifestFileName)
        : fromTomlPackages(fileContent, manifestFileName);
}

/** One row per normalised name, first version seen. */
function collector(manifestFileName) {
    const byName = new Map();

    return {
        add(name, version) {
            if (!name) return;
            const key = normalizePythonName(name);
            if (byName.has(key)) return;

            byName.set(
                key,
                new Dependency({
                    ecosystem: 'PIP',
                    name: key,
                    version: version || null,
                    manifestFile: manifestFileName,
                })
            );
        },
        rows: () => [...byName.values()],
    };
}

/**
 * poetry.lock, uv.lock and pdm.lock.
 *
 * Read line by line, as gradleCatalogParser.js reads its TOML — there is no
 * TOML parser in the dependency tree and this does not justify adding one.
 *
 * The trap is the sub-tables. A `[[package]]` element is followed by
 * `[package.dependencies]`, whose keys are that package's own constraints and
 * are already listed as `[[package]]` elements of their own, and by
 * `[package.source]`, which describes where the package came from. Reading a
 * `name` key from either would add rows that are duplicates or nonsense — so
 * only keys directly under `[[package]]` count.
 */
function fromTomlPackages(content, manifestFileName) {
    const out = collector(manifestFileName);
    let inPackage = false;
    let current = null;

    function flush() {
        // A package whose source is local code is not a dependency at all; one
        // fetched from git or a URL is, with no version to compare.
        if (current && !current.local) out.add(current.name, current.remote ? null : current.version);
        current = null;
    }

    for (const raw of content.split('\n')) {
        const line = raw.trimEnd();
        if (!line.trim() || line.trim().startsWith('#')) continue;

        const header = line.match(/^\[+([^\]]+)\]+/);
        if (header) {
            const table = header[1].trim();

            if (table === 'package') {
                flush();
                inPackage = true;
                current = { name: null, version: null, local: false, remote: false };
            } else {
                // A sub-table of the package, or [metadata] — either way, keys
                // from here on are not the package's own identity.
                if (table.startsWith('package.')) {
                    inPackage = false;
                } else {
                    flush();
                    inPackage = false;
                }
            }

            // Poetry states a git or path dependency in [package.source].
            if (table === 'package.source' && current) current.sourceTable = true;
            continue;
        }

        if (!current) continue;

        // Poetry's [package.source] type says which kind of source it is.
        if (current.sourceTable && !inPackage) {
            const type = line.match(/^type\s*=\s*"([^"]+)"/);
            if (type) {
                if (['directory', 'file'].includes(type[1])) current.local = true;
                if (['git', 'url'].includes(type[1])) current.remote = true;
            }
            continue;
        }

        if (!inPackage) continue;

        // Only unindented keys: uv writes its dependency list as inline tables,
        // `{ name = "idna" }`, and those are constraints on other packages.
        const name = line.match(/^name\s*=\s*"([^"]+)"/);
        if (name) {
            current.name = name[1];
            continue;
        }

        const version = line.match(/^version\s*=\s*"([^"]+)"/);
        if (version) {
            current.version = version[1];
            continue;
        }

        // uv states the source inline: { registry = ... }, { editable = "." }.
        const source = line.match(/^source\s*=\s*(.*)$/);
        if (source) {
            if (LOCAL_SOURCE.test(source[1])) current.local = true;
            else if (REMOTE_UNVERSIONED.test(source[1])) current.remote = true;
        }
    }

    flush();
    return out.rows();
}

/**
 * Pipfile.lock.
 *
 * JSON, with `default` and `develop` maps. A dev dependency runs in CI and in a
 * developer's container, which is still exposure, so both are read.
 */
function fromPipenv(content, manifestFileName) {
    const out = collector(manifestFileName);

    let document;
    try {
        document = JSON.parse(content);
    } catch {
        return [];
    }

    for (const section of ['default', 'develop']) {
        for (const [name, entry] of Object.entries(document?.[section] ?? {})) {
            // A path or file entry is local code in the repository.
            if (entry?.path || entry?.file) continue;

            // Pipenv stores the version with its operator: "==4.2.7". A resolved
            // version with == in front of it will not compare against PyPI's
            // answer, and comparing is the whole point of a lockfile row.
            const version = entry?.git ? null : (entry?.version ?? '').replace(/^==/, '');

            out.add(name, version);
        }
    }

    return out.rows();
}
