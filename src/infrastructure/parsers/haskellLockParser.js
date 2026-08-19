import Dependency from '../../domain/entities/Dependency.js';
import { splitTrailingVersion } from './haskellParser.js';

/**
 * Parse cabal.project.freeze and stack.yaml.lock.
 *
 * Both state exact versions, so their rows supersede the constraints in a
 * `.cabal` file or a `stack.yaml`. See reconcileDependencies.js.
 */
export const manifestFiles = ['cabal.project.freeze', 'stack.yaml.lock'];

export const resolvesVersions = true;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    return manifestFileName.split('/').pop() === 'stack.yaml.lock'
        ? fromStackLock(fileContent, manifestFileName)
        : fromFreeze(fileContent, manifestFileName);
}

function collector(manifestFileName) {
    const byName = new Map();

    return {
        add(name, version) {
            if (!name || byName.has(name)) return;

            byName.set(
                name,
                new Dependency({
                    ecosystem: 'HACKAGE',
                    name,
                    version: version || null,
                    manifestFile: manifestFileName,
                })
            );
        },
        rows: () => [...byName.values()],
    };
}

/**
 * cabal.project.freeze.
 *
 * One `constraints:` list, wrapped across lines, of `any.aeson ==2.2.1.0`
 * entries. The same list also carries flag constraints — `aeson -cffi`, `text
 * +simdutf` — which name a package and set a build flag rather than a version,
 * so an entry is only read when it pins one.
 *
 * `active-repositories:` and `index-state:` are the file's own settings.
 */
function fromFreeze(content, manifestFileName) {
    const out = collector(manifestFileName);

    for (const raw of content.split('\n')) {
        const line = raw.trim().replace(/^constraints\s*:\s*/, '');
        if (!line || line.startsWith('--')) continue;
        if (/^(active-repositories|index-state|with-compiler|package)\b/.test(line)) continue;

        for (const entry of line.split(',')) {
            const pinned = entry.trim().match(/^(?:any\.)?([A-Za-z][\w-]*)\s*==\s*([\w.]+)/);
            if (pinned) out.add(pinned[1], pinned[2]);
        }
    }

    return out.rows();
}

/**
 * stack.yaml.lock.
 *
 * A `hackage: name-1.2.3@sha256:…,4567` line per extra-dep, twice each — once
 * under `completed:` with the hash and once under `original:` without — plus a
 * `snapshots:` list pinning the LTS set itself by URL and hash. The snapshot is
 * not a package, and neither is the `pantry-tree` beside it.
 */
function fromStackLock(content, manifestFileName) {
    const out = collector(manifestFileName);

    for (const raw of content.split('\n')) {
        const pinned = raw.trim().match(/^hackage\s*:\s*([^\s@]+)/);
        if (!pinned) continue;

        const split = splitTrailingVersion(pinned[1]);
        out.add(split.name, split.version);
    }

    return out.rows();
}
