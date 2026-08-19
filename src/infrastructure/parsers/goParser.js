import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Go module files (go.mod).
 */
export const manifestFiles = ['go.mod'];

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];
    const replacements = replacementsIn(fileContent);

    // Match require block: require ( ... )
    const requireBlock = fileContent.match(/require\s*\(([\s\S]*?)\)/g);
    if (requireBlock) {
        for (const block of requireBlock) {
            const inner = block.replace(/require\s*\(/, '').replace(/\)$/, '');
            for (const line of inner.split('\n')) {
                const dep = parseRequireLine(line, manifestFileName, replacements);
                if (dep) deps.push(dep);
            }
        }
    }

    // Match single-line require: require github.com/pkg v1.0.0
    for (const line of fileContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('require ') && !trimmed.includes('(')) {
            const dep = parseRequireLine(trimmed.replace(/^require\s+/, ''), manifestFileName, replacements);
            if (dep) deps.push(dep);
        }
    }

    return deps;
}

/**
 * The `replace` directives, keyed by the module path they redirect.
 *
 * A replace means the build is not running what `require` names, so reading the
 * requires alone reports a version that is not there. Kubernetes redirects more
 * than a hundred of its own modules to `./staging/src/...`, and every one of
 * those requires names a version nothing compiles.
 *
 * Both forms appear: a block, `replace ( old => new v1.2.3 )`, and a single
 * line. The left side may carry a version of its own, which narrows the
 * redirect to that version; for deciding what is in the build the path is
 * enough.
 *
 * @param {string} fileContent
 * @returns {Map<string, { path: string, version: string|null }>}
 */
function replacementsIn(fileContent) {
    const replacements = new Map();

    for (const raw of fileContent.split('\n')) {
        const line = raw.trim().replace(/^replace\s+/, '');
        if (!line || line.startsWith('//')) continue;

        const directive = line.match(/^(\S+)(?:\s+\S+)?\s*=>\s*(\S+)(?:\s+(\S+))?/);
        if (!directive) continue;

        replacements.set(directive[1], { path: directive[2], version: directive[3] ?? null });
    }

    return replacements;
}

/** A replacement target that is a directory in this repository. */
function isLocalPath(path) {
    return path.startsWith('./') || path.startsWith('../') || path.startsWith('/');
}

function parseRequireLine(line, manifestFileName, replacements) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith(')')) return null;

    // Module path and version: github.com/pkg/errors v0.9.1
    const match = trimmed.match(/^(\S+)\s+(v[\d.]+\S*)/);
    if (!match) return null;

    const replaced = replacements.get(match[1]);

    // Redirected to a directory in this repository: the module in the build is
    // local code, which no CVE can match and the proxy knows nothing about.
    if (replaced && isLocalPath(replaced.path)) return null;

    return new Dependency({
        ecosystem: 'GO',
        // A redirect to another module means that module is what is compiled,
        // under its own path and at its own version.
        name: replaced ? replaced.path : match[1],
        version: replaced ? replaced.version : match[2],
        manifestFile: manifestFileName,
    });
}
