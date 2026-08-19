import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse a CocoaPods Podfile.lock.
 *
 * Read line by line rather than with a YAML parser: the `PODS:` section has a
 * fixed two-space-indent shape, and the rest of this directory reads its
 * formats the same way instead of pulling a parser into the tree for one file.
 */
export const manifestFiles = ['Podfile.lock'];

// Podfile.lock states the version in the build, so its rows supersede a
// constraint read from a Podfile. See reconcileDependencies.js.
export const resolvesVersions = true;

// Two spaces is a pod that is in the build in its own right; four is a
// subdependency of the pod above it, which is already listed at the top level.
const TOP_LEVEL_POD = /^ {2}- (.+?)$/;
const NAME_AND_VERSION = /^(.*?)\s*\(([^)]*)\)$/;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];
    let inPods = false;

    for (const line of fileContent.split('\n')) {
        if (!line.trim()) continue;

        // Section headers sit at column zero. Anything after PODS: belongs to
        // another section — DEPENDENCIES repeats the same pods without their
        // resolved versions, and counting those would double every number.
        if (!/^\s/.test(line)) {
            inPods = line.trim() === 'PODS:';
            continue;
        }

        if (!inPods) continue;

        const entry = line.replace(/:\s*$/, '').match(TOP_LEVEL_POD);
        if (!entry) continue;

        // A pod whose name YAML had to quote, usually for a version operator.
        const text = entry[1].trim().replace(/^"(.*)"$/, '$1');
        const parts = text.match(NAME_AND_VERSION);

        deps.push(new Dependency({
            ecosystem: 'COCOAPODS',
            // Firebase and Firebase/Analytics are different things to advise
            // about, so a subspec keeps its full name.
            name: parts ? parts[1] : text,
            version: parts ? parts[2] : null,
            manifestFile: manifestFileName,
        }));
    }

    return deps;
}
