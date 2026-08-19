import Dependency from '../../domain/entities/Dependency.js';
import { lowerVersion } from './pickVersion.js';

/**
 * Parse what .NET actually restores.
 *
 * `.csproj` carries a `PackageReference` with a constraint; these two carry the
 * version that ends up in the output.
 *
 * `packages.config` is a manifest by name, and authoritative anyway: the format
 * predates floating versions and records an exact one by construction. That
 * reads like an exception to the rule and is not — see reconcileDependencies.js
 * for what the flag means.
 */
export const manifestFiles = ['packages.lock.json', 'packages.config'];

export const resolvesVersions = true;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    return manifestFileName.split('/').pop() === 'packages.config'
        ? fromPackagesConfig(fileContent, manifestFileName)
        : fromLockFile(fileContent, manifestFileName);
}

/** One row per package, lowest version, as pickVersion.js explains. */
function collector(manifestFileName) {
    const byName = new Map();

    return {
        add(name, version) {
            if (!name) return;

            const existing = byName.get(name);
            if (existing) {
                existing.version = lowerVersion(existing.version, version);
                return;
            }

            byName.set(
                name,
                new Dependency({
                    ecosystem: 'NUGET',
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
 * packages.lock.json.
 *
 * Packages are nested under a target framework, and a project that multi-targets
 * lists every one of them again per framework: Ocelot's has 27 entries for 9
 * packages across net8.0, net9.0 and net10.0. Without collapsing that, every
 * count the console shows triples.
 */
function fromLockFile(content, manifestFileName) {
    const out = collector(manifestFileName);

    let document;
    try {
        document = JSON.parse(content);
    } catch {
        return [];
    }

    for (const packages of Object.values(document?.dependencies ?? {})) {
        for (const [name, entry] of Object.entries(packages ?? {})) {
            // `Project` is a reference to another project in the solution, so it
            // is code in this repository rather than a package to advise about.
            if (entry?.type === 'Project') continue;

            // Transitive counts: a package restored into the output is in the
            // output however it got there.
            out.add(name, entry?.resolved);
        }
    }

    return out.rows();
}

/**
 * packages.config.
 *
 * The pre-2017 format, still in every legacy .NET Framework repository. XML, one
 * self-closing element per package, and the version is exact.
 */
function fromPackagesConfig(content, manifestFileName) {
    const out = collector(manifestFileName);

    // Attribute order is not fixed, so id and version are matched separately
    // within one element rather than in sequence.
    for (const element of content.match(/<package\b[^>]*\/?>/g) ?? []) {
        const id = element.match(/\bid\s*=\s*"([^"]*)"/);
        const version = element.match(/\bversion\s*=\s*"([^"]*)"/);
        if (id) out.add(id[1], version?.[1]);
    }

    return out.rows();
}
