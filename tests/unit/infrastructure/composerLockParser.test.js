import { describe, test, expect } from '@jest/globals';

const parser = await import('#app/infrastructure/parsers/composerLockParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');

// Trimmed from composer/composer's own lockfile, where 94 of the 153 packages
// carry a `v` prefix — which is what makes that the first thing to get right.
const COMPOSER_LOCK = JSON.stringify({
    _readme: ['This file locks the dependencies of your project to a known state'],
    'content-hash': 'fake',
    packages: [
        {
            name: 'composer/semver',
            version: '3.4.4',
            source: { type: 'git', url: 'https://github.com/composer/semver.git', reference: 'abc123' },
            require: { php: '^7.2 || ^8.0' },
        },
        {
            name: 'dflydev/dot-access-data',
            version: 'v3.0.3',
            source: { type: 'git', url: 'https://github.com/dflydev/dot-access-data.git', reference: 'def456' },
        },
        {
            name: 'someone/unreleased',
            version: 'dev-main',
            source: { type: 'git', url: 'https://github.com/someone/unreleased.git', reference: 'aabbcc' },
        },
    ],
    'packages-dev': [
        {
            name: 'phpunit/phpunit',
            version: '11.5.2',
            source: { type: 'git', url: 'https://github.com/sebastianbergmann/phpunit.git', reference: 'ghi789' },
        },
        // Already in packages: composer allows it and it must not be two rows.
        {
            name: 'composer/semver',
            version: '3.4.4',
            source: { type: 'git', url: 'https://github.com/composer/semver.git', reference: 'abc123' },
        },
    ],
    platform: { php: '^8.2', 'ext-json': '*' },
    'platform-dev': [],
});

const read = content =>
    Object.fromEntries(parser.parse(content, 'composer.lock').map(d => [d.name, d.version]));

describe('discovery', () => {
    test.each([
        ['composer.lock', 1],
        ['app/composer.lock', 1],
        ['composer.json', 1],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });

    test('it states resolved versions, so its rows win over composer.json', () => {
        expect(parser.resolvesVersions).toBe(true);
    });
});

describe('composer.lock', () => {
    const deps = read(COMPOSER_LOCK);

    test('reads a package at its resolved version', () => {
        expect(deps['composer/semver']).toBe('3.4.4');
    });

    // v8.2.14 and 8.2.14 are the same release. Storing both spellings makes one
    // package look like two, and the prefixed half fails against Packagist.
    test('a v prefix comes off', () => {
        expect(deps['dflydev/dot-access-data']).toBe('3.0.3');
    });

    // Every entry's source.type is git, because that is how Packagist serves
    // everything, so the source says nothing about whether this is a release.
    test('a dev- branch install is not a version', () => {
        expect(deps).toHaveProperty('someone/unreleased');
        expect(deps['someone/unreleased']).toBeNull();
    });

    test('packages-dev counts', () => {
        expect(deps['phpunit/phpunit']).toBe('11.5.2');
    });

    test('a package in both lists is one row', () => {
        expect(parser.parse(COMPOSER_LOCK, 'composer.lock').filter(d => d.name === 'composer/semver')).toHaveLength(1);
    });

    describe('what is not a dependency', () => {
        // platform states the PHP version and the extensions required, neither
        // of which is a Packagist package.
        test('the platform requirements', () => {
            expect(deps).not.toHaveProperty('php');
            expect(deps).not.toHaveProperty('ext-json');
        });

        test('every name is vendor/package', () => {
            expect(Object.keys(deps).every(name => name.includes('/'))).toBe(true);
        });
    });
});

describe('what must not throw', () => {
    test.each([
        ['not json at all'],
        ['{}'],
        ['{"packages": []}'],
        ['{"packages": [{"version": "1.0"}]}'],
    ])('%s', content => {
        expect(parser.parse(content, 'composer.lock')).toEqual([]);
    });
});
