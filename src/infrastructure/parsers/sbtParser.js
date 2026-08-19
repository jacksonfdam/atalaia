import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse a build.sbt.
 *
 * Scala projects are Maven projects underneath: an sbt dependency resolves from
 * Maven Central, so these rows are `MAVEN` and the existing lookup answers about
 * them.
 *
 * A build.sbt is a Scala program, and real ones are written with variables
 * — typelevel/cats declares `"org.scalacheck" %%% "scalacheck" % scalaCheckVersion`
 * and sets `scalaVersion := Scala213`. Only quoted arguments are read; anything
 * else is code this parser cannot evaluate and must not pretend to, so most
 * dependencies in a real build file report an unknown version. That is the
 * honest answer, and it is still worth naming the dependency.
 */
export const manifestFiles = ['build.sbt'];

// "org" % "artifact" % "1.2.3", and the %% and %%% variants.
const DEPENDENCY = /"([^"]+)"\s*(%{1,3})\s*"([^"]+)"\s*%\s*(?:"([^"]+)")?/;

// scalaVersion := "2.13.12". Frequently a variable instead, in which case the
// binary version cannot be worked out from the file.
const SCALA_VERSION = /scalaVersion\s*(?:in\s+\S+\s*)?:=\s*"([^"]+)"/;

/**
 * The suffix Maven Central actually has on a cross-built artifact.
 *
 * `%%` appends the Scala binary version to the artifact name: `cats-core`
 * published for Scala 2.13 is `cats-core_2.13` on Central. Scala 3 uses a bare
 * `3` rather than `3.3`.
 *
 * @param {string|null} scalaVersion
 * @returns {string}
 */
function binarySuffix(scalaVersion) {
    if (!scalaVersion) return '';
    if (scalaVersion.startsWith('3')) return '_3';

    const parts = scalaVersion.split('.');
    return parts.length >= 2 ? `_${parts[0]}.${parts[1]}` : '';
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const byName = new Map();
    const scala = fileContent.match(SCALA_VERSION);
    // Without a literal scalaVersion the suffix is unknowable, and guessing one
    // would name an artifact that may not exist. The un-suffixed name is at
    // least the right package to correlate a CVE against.
    const suffix = binarySuffix(scala?.[1] ?? null);

    for (const raw of fileContent.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('//')) continue;

        const declared = line.match(DEPENDENCY);
        if (!declared) continue;

        const [, group, percents, artifact, version] = declared;
        // A single % is a plain Java artifact; %% and %%% are cross-built.
        const name = `${group}:${artifact}${percents === '%' ? '' : suffix}`;

        if (byName.has(name)) continue;

        byName.set(
            name,
            new Dependency({
                ecosystem: 'MAVEN',
                name,
                version: version ?? null,
                manifestFile: manifestFileName,
            })
        );
    }

    return [...byName.values()];
}
