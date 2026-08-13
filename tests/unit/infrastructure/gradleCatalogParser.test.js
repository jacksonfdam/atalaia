import { describe, test, expect } from '@jest/globals';

const parser = await import('#app/infrastructure/parsers/gradleCatalogParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');

const CATALOG = `
[versions]
compose-hot-reload = "1.0.0-rc02"
kotlin = "2.2.21"
coroutines = "1.10.2"

[libraries]
kotlinx-coroutines-core = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version.ref = "coroutines" }
material = { group = "com.google.android.material", name = "material", version = "1.11.0" }
junit = "junit:junit:4.13.2"
no-version = { module = "com.example:thing" }

[plugins]
composeCompiler = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
composeHotReload = { id = "org.jetbrains.compose.hot-reload", version.ref = "compose-hot-reload" }
shorthand = "com.example.plugin:3.2.1"
# commented = { id = "should.not.appear", version.ref = "kotlin" }

[bundles]
ui = ["material", "junit"]
`;

describe('catalog discovery', () => {
    test.each([
        ['gradle/libs.versions.toml', 1],
        ['gradle/deps.versions.toml', 1],
        ['libs.versions.toml', 1],
        ['androidApp/gradle/libs.versions.toml', 1],
        ['config/settings.toml', 0],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });
});

describe('gradleCatalogParser', () => {
    const deps = parser.parse(CATALOG, 'libs.versions.toml');
    const byName = name => deps.find(dependency => dependency.name === name);

    test('resolves a version reference into the declared version', () => {
        expect(byName('org.jetbrains.kotlinx:kotlinx-coroutines-core')).toMatchObject({
            ecosystem: 'MAVEN',
            version: '1.10.2',
        });
    });

    test('reads group and name given separately', () => {
        expect(byName('com.google.android.material:material')).toMatchObject({ version: '1.11.0' });
    });

    test('reads the shorthand string form', () => {
        expect(byName('junit:junit')).toMatchObject({ ecosystem: 'MAVEN', version: '4.13.2' });
    });

    test('keeps a library that declares no version', () => {
        expect(byName('com.example:thing')).toMatchObject({ version: null });
    });

    test('records plugins by id, with the referenced version', () => {
        expect(byName('org.jetbrains.kotlin.plugin.compose')).toMatchObject({
            ecosystem: 'GRADLE',
            version: '2.2.21',
        });
        expect(byName('org.jetbrains.compose.hot-reload')).toMatchObject({ version: '1.0.0-rc02' });
        expect(byName('com.example.plugin')).toMatchObject({ ecosystem: 'GRADLE', version: '3.2.1' });
    });

    test('ignores comments and bundles', () => {
        expect(byName('should.not.appear')).toBeUndefined();
        expect(deps.some(dependency => dependency.name === 'ui')).toBe(false);
    });

    test('finds everything in the catalog and nothing else', () => {
        expect(deps).toHaveLength(7);
    });
});
