import { describe, test, expect } from '@jest/globals';

const gradleLock = await import('#app/infrastructure/parsers/gradleLockParser.js');
const sbt = await import('#app/infrastructure/parsers/sbtParser.js');
const ivy = await import('#app/infrastructure/parsers/ivyParser.js');
const catalog = await import('#app/infrastructure/parsers/gradleCatalogParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');

// Trimmed from Netflix/maestro: 72 lines describing 52 modules, closing with the
// `empty=` line that lists configurations which resolved to nothing.
const GRADLE_LOCKFILE = `# This is a Gradle generated file for dependency locking.
# Manual edits can break the build and are not advised.
# This file is expected to be part of source control.
com.github.spotbugs:spotbugs-annotations:4.10.3=spotbugs
com.github.spotbugs:spotbugs:4.10.3=spotbugs
com.google.guava:guava:33.0.0-jre=compileClasspath,runtimeClasspath
org.slf4j:slf4j-api:1.7.36=compileClasspath
org.slf4j:slf4j-api:2.0.13=runtimeClasspath
empty=runtimeClasspath,spotbugsPlugins,testRuntimeClasspath
`;

const BUILD_SBT = `ThisBuild / scalaVersion := "2.13.12"

lazy val core = project
  .settings(
    libraryDependencies += "org.typelevel" %% "cats-core" % "2.10.0",
    libraryDependencies ++= Seq(
      "com.typesafe" % "config" % "1.4.3",
      "org.scalatest" %% "scalatest" % "3.2.17" % Test,
      "org.scalacheck" %%% "scalacheck" % scalaCheckVersion % Test,
    ),
    // libraryDependencies += "commented" %% "out" % "1.0.0",
  )
`;

const BUILD_SBT_SCALA_3 = `ThisBuild / scalaVersion := "3.3.1"

libraryDependencies += "org.typelevel" %% "cats-core" % "2.10.0"
`;

// typelevel/cats sets scalaVersion := Scala213, a variable.
const BUILD_SBT_VARIABLE_SCALA = `ThisBuild / scalaVersion := Scala213

libraryDependencies += "org.typelevel" %% "cats-core" % "2.10.0"
`;

const IVY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ivy-module version="2.0">
  <info organisation="com.example" module="legacy-app" revision="1.0"/>
  <dependencies>
    <dependency org="commons-lang" name="commons-lang" rev="2.6"/>
    <dependency name="log4j" org="log4j" rev="1.2.17" conf="default->default"/>
    <dependency org="junit" name="junit" rev="latest.integration"/>
    <dependency org="no-revision" name="thing"/>
  </dependencies>
</ivy-module>
`;

const read = (parser, content, file) =>
    Object.fromEntries(parser.parse(content, file).map(d => [d.name, d.version]));

describe('discovery', () => {
    test.each([
        ['gradle.lockfile', 1],
        ['build.sbt', 1],
        ['ivy.xml', 1],
        ['app/gradle.lockfile', 1],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });

    test('only the lockfile resolves versions', () => {
        expect(gradleLock.resolvesVersions).toBe(true);
        expect(sbt.resolvesVersions).toBeUndefined();
        expect(ivy.resolvesVersions).toBeUndefined();
    });
});

describe('gradle.lockfile', () => {
    const deps = read(gradleLock, GRADLE_LOCKFILE, 'gradle.lockfile');

    test('reads a module at its resolved version', () => {
        expect(deps['com.google.guava:guava']).toBe('33.0.0-jre');
    });

    // The name has to match what gradleCatalogParser.js produces, or the
    // reconciliation in #20 cannot tell a catalog row and a lock row apart.
    test('the name is group:artifact, as the catalog parser writes it', () => {
        const fromCatalog = catalog.parse(
            '[libraries]\nguava = { module = "com.google.guava:guava", version = "33.0.0-jre" }\n',
            'libs.versions.toml'
        );

        expect(fromCatalog[0].name).toBe('com.google.guava:guava');
        expect(Object.keys(deps)).toContain('com.google.guava:guava');
    });

    // A module can resolve differently per configuration: 1.7.36 on the compile
    // classpath and 2.0.13 at runtime. See pickVersion.js.
    test('two configurations at two versions keep the lower one', () => {
        expect(deps['org.slf4j:slf4j-api']).toBe('1.7.36');
    });

    // `empty=runtimeClasspath,…` lists configurations that resolved to nothing.
    test('the empty line is not a module', () => {
        expect(deps).not.toHaveProperty('empty');
        expect(Object.keys(deps)).toHaveLength(4);
    });

    test('the comment header is not a module', () => {
        expect(Object.keys(deps).every(name => name.split(':').length === 2)).toBe(true);
    });
});

describe('build.sbt', () => {
    const deps = read(sbt, BUILD_SBT, 'build.sbt');

    // %% appends the Scala binary version to the artifact name: cats-core built
    // for 2.13 is cats-core_2.13 on Maven Central, and asking about the
    // un-suffixed name finds nothing.
    test('a %% dependency carries the Scala binary version', () => {
        expect(deps['org.typelevel:cats-core_2.13']).toBe('2.10.0');
    });

    test('a single % dependency is a plain Java artifact', () => {
        expect(deps['com.typesafe:config']).toBe('1.4.3');
    });

    test('a %%% cross-project dependency is cross-built too', () => {
        expect(Object.keys(deps)).toContain('org.scalacheck:scalacheck_2.13');
    });

    test('Scala 3 uses a bare 3 rather than 3.3', () => {
        expect(Object.keys(read(sbt, BUILD_SBT_SCALA_3, 'build.sbt'))).toContain(
            'org.typelevel:cats-core_3'
        );
    });

    // typelevel/cats writes `scalaVersion := Scala213`. Guessing a suffix would
    // name an artifact that may not exist; the un-suffixed name is at least the
    // right package to correlate a CVE against.
    test('a variable scalaVersion means no suffix rather than a guessed one', () => {
        expect(read(sbt, BUILD_SBT_VARIABLE_SCALA, 'build.sbt')).toEqual({
            'org.typelevel:cats-core': '2.10.0',
        });
    });

    // A build.sbt is a Scala program. cats declares
    // `"org.scalacheck" %%% "scalacheck" % scalaCheckVersion`, and a parser that
    // cannot evaluate Scala must not store the word scalaCheckVersion.
    test('a variable version is unknown, not the variable name', () => {
        expect(deps['org.scalacheck:scalacheck_2.13']).toBeNull();
    });

    test('a commented dependency is not read', () => {
        expect(Object.keys(deps)).not.toContain('commented:out_2.13');
    });

    test('a Test scope is not part of the version', () => {
        expect(deps['org.scalatest:scalatest_2.13']).toBe('3.2.17');
    });
});

describe('ivy.xml', () => {
    const deps = read(ivy, IVY_XML, 'ivy.xml');

    test('reads a dependency', () => {
        expect(deps['commons-lang:commons-lang']).toBe('2.6');
    });

    test('attribute order does not matter', () => {
        expect(deps['log4j:log4j']).toBe('1.2.17');
    });

    // Ivy never states what it resolved to, so a dynamic revision is stored as
    // it stands and reported uncomparable downstream.
    test('a dynamic revision is kept as it stands', () => {
        expect(deps['junit:junit']).toBe('latest.integration');
    });

    test('a dependency with no revision reports unknown', () => {
        expect(deps['no-revision:thing']).toBeNull();
    });

    // <info organisation="com.example" module="legacy-app"> is the module's own
    // identity, not a dependency.
    test('the info element is not a dependency', () => {
        expect(Object.keys(deps)).not.toContain('com.example:legacy-app');
        expect(Object.keys(deps)).toHaveLength(4);
    });
});

describe('what must not throw', () => {
    test.each([
        [gradleLock, 'gradle.lockfile', '# only a comment\nempty=runtimeClasspath\n'],
        [gradleLock, 'gradle.lockfile', ''],
        // scalatest's build.sbt delegates everything to project/ScalatestBuild.scala
        // and declares nothing. Zero is the right answer, not a failure.
        [sbt, 'build.sbt', 'lazy val core = ScalatestBuild.core\n'],
        [ivy, 'ivy.xml', '<ivy-module version="2.0"><dependencies/></ivy-module>'],
    ])('%#', (parser, file, content) => {
        expect(parser.parse(content, file)).toEqual([]);
    });
});
