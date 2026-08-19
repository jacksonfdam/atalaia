import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse a Dart or Flutter pubspec.lock.
 *
 * Every package in the build, transitive ones included — a Flutter application
 * pulls in most of its surface transitively, and a CVE does not care how a
 * package arrived.
 */
export const manifestFiles = ['pubspec.lock'];

// pubspec.lock states the version in the build, so its rows supersede the
// constraints read from pubspec.yaml. See reconcileDependencies.js.
export const resolvesVersions = true;

const PACKAGE = /^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*$/;
const FIELD = /^ {4}(source|version):\s*(.*)$/;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];
    let inPackages = false;
    let current = null;

    /** Store whatever has been collected for the package being read. */
    function flush() {
        if (!current) return;

        deps.push(new Dependency({
            ecosystem: 'PUB',
            name: current.name,
            // A path, git or SDK package has a version, but it is the one in
            // that package's own pubspec — nothing pub.dev can be asked about,
            // and comparing it against a registry answer would invent a verdict.
            version: current.source === 'hosted' ? current.version : null,
            manifestFile: manifestFileName,
        }));
        current = null;
    }

    for (const line of fileContent.split('\n')) {
        if (!line.trim() || line.trim().startsWith('#')) continue;

        // `packages:` and `sdks:` both sit at column zero. The SDK bounds under
        // the second are not packages.
        if (!/^\s/.test(line)) {
            flush();
            inPackages = line.trim() === 'packages:';
            continue;
        }

        if (!inPackages) continue;

        const pkg = line.match(PACKAGE);
        if (pkg) {
            flush();
            current = { name: pkg[1], source: null, version: null };
            continue;
        }

        const field = line.match(FIELD);
        // Everything else is inside `description:`, one level deeper, where a
        // git package repeats `url:` and a hosted one carries its `sha256:`.
        if (field && current) {
            current[field[1]] = field[2].trim().replace(/^["']|["']$/g, '');
        }
    }

    flush();
    return deps;
}
