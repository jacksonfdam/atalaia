import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Paket's dependency files.
 *
 * Paket is a minority manager but it replaces NuGet restore entirely, so a Paket
 * repository has no useful `PackageReference` version anywhere — without this it
 * scans as having nothing.
 *
 * The rows are `NUGET`: the packages come from nuget.org and only the resolver
 * differs, so the existing NuGet version lookup answers about them.
 */
export const manifestFiles = ['paket.dependencies'];

// A `nuget` line carries a constraint: `nuget Argu >= 5.1.0`. paket.lock records
// what that resolved to, and paketLockParser.js reads it.
const NUGET_LINE = /^nuget\s+(\S+)(?:\s+(.*))?$/;

// Settings, not part of the constraint: `redirects: force`, `framework: net45`,
// `copy_local: true`. Anchored at the start as well as after a space, because a
// line can carry a setting and no constraint at all — Paket's own file has
// `nuget DotNet.ReproducibleBuilds copy_local: true`, which is version unknown.
const SETTING = /(?:^|\s)[a-z_]+:\s*\S+/g;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];

    for (const raw of fileContent.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;

        // `github fsharp/FAKE src/app/FakeLib/Globbing.fs` pulls a single source
        // file into the build. It is not a package, has no version, and nothing
        // on nuget.org answers about it.
        const declared = line.match(NUGET_LINE);
        if (!declared) continue;

        const constraint = (declared[2] ?? '').replace(SETTING, '').trim();

        deps.push(
            new Dependency({
                ecosystem: 'NUGET',
                name: declared[1],
                version: constraint || null,
                manifestFile: manifestFileName,
            })
        );
    }

    return deps;
}
