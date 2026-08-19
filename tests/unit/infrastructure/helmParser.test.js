import { describe, test, expect } from '@jest/globals';

const chart = await import('#app/infrastructure/parsers/helmParser.js');
const lock = await import('#app/infrastructure/parsers/helmLockParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');

/**
 * Two indentation styles, both real.
 *
 * Bitnami writes an entry's keys alphabetically, so the dash carries
 * `condition:` and `name:` arrives two lines later — a parser matching on
 * `- name:` finds nothing in the charts most people actually run. The second
 * fixture is the conventional shape from Helm's own documentation.
 */

// Trimmed from bitnami/charts, bitnami/wordpress/Chart.yaml.
const BITNAMI = `annotations:
  category: CMS
apiVersion: v2
appVersion: 6.8.2
dependencies:
- condition: memcached.enabled
  name: memcached
  repository: oci://registry-1.docker.io/bitnamicharts
  version: 7.x.x
- condition: mariadb.enabled
  name: mariadb
  repository: oci://registry-1.docker.io/bitnamicharts
  version: 22.x.x
- name: common
  repository: oci://registry-1.docker.io/bitnamicharts
  tags:
  - bitnami-common
  version: 2.x.x
description: WordPress is the world's most popular blogging platform
name: wordpress
version: 26.0.5
`;

const CONVENTIONAL = `apiVersion: v2
name: mychart
description: A Helm chart for Kubernetes
type: application
version: 0.1.0
appVersion: "1.16.0"

dependencies:
  - name: postgresql
    version: "12.1.2"
    repository: https://charts.bitnami.com/bitnami
    condition: postgresql.enabled
  - name: redis
    version: ~17.0.0
    repository: "@bitnami"
    alias: cache
    tags:
      - cache

maintainers:
  - name: someone
    email: someone@example.com
`;

// Written by helm dependency update. The dash is at column zero here too.
const CHART_LOCK = `dependencies:
- name: memcached
  repository: oci://registry-1.docker.io/bitnamicharts
  version: 7.9.7
- name: mariadb
  repository: oci://registry-1.docker.io/bitnamicharts
  version: 22.0.0
- name: common
  repository: oci://registry-1.docker.io/bitnamicharts
  version: 2.31.4
digest: sha256:90bb914faa525f3b5b11f8a5eaa39a47ee3f3117f9330d0babc78a03001a1663
generated: "2025-08-18T16:50:21.811944+02:00"
`;

describe('discovery', () => {
    test.each([
        ['Chart.yaml', 1],
        ['Chart.lock', 1],
        ['charts/api/Chart.yaml', 1],
        ['values.yaml', 0],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });

    test('only the lockfile claims to resolve versions', () => {
        expect(lock.resolvesVersions).toBe(true);
        expect(chart.resolvesVersions).toBeUndefined();
    });
});

describe('Chart.yaml, keys in alphabetical order', () => {
    const deps = chart.parse(BITNAMI, 'Chart.yaml');
    const byName = name => deps.find(dependency => dependency.name === name);

    test('finds all three subcharts even though none starts with name:', () => {
        expect(deps.map(d => d.name)).toEqual(['memcached', 'mariadb', 'common']);
    });

    test('reads the range, not the resolution', () => {
        expect(byName('memcached')).toMatchObject({
            ecosystem: 'HELM',
            version: '7.x.x',
            manifestFile: 'Chart.yaml',
        });
    });

    // Reading these would file every chart as depending on itself.
    test("the chart's own name and version are not dependencies", () => {
        expect(byName('wordpress')).toBeUndefined();
        expect(deps.some(d => d.version === '26.0.5')).toBe(false);
    });

    test('a tags: sub-list is not a dependency', () => {
        expect(byName('bitnami-common')).toBeUndefined();
        expect(deps).toHaveLength(3);
    });
});

describe('Chart.yaml, conventional indentation', () => {
    const deps = chart.parse(CONVENTIONAL, 'Chart.yaml');

    test('reads both subcharts', () => {
        expect(deps.map(d => `${d.name}@${d.version}`)).toEqual([
            'postgresql@12.1.2',
            'redis@~17.0.0',
        ]);
    });

    // A different list further down the file, at the same indentation as the
    // dependency entries.
    test('a maintainers list is not dependencies', () => {
        expect(deps.map(d => d.name)).not.toContain('someone');
    });

    test('an indented tags: sub-list is not a dependency', () => {
        expect(deps).toHaveLength(2);
    });
});

describe('Chart.lock', () => {
    const deps = lock.parse(CHART_LOCK, 'Chart.lock');

    test('reads the resolved version of every subchart', () => {
        expect(deps.map(d => `${d.name}@${d.version}`)).toEqual([
            'memcached@7.9.7',
            'mariadb@22.0.0',
            'common@2.31.4',
        ]);
    });

    test('digest and generated are not dependencies', () => {
        expect(deps).toHaveLength(3);
        expect(deps.map(d => d.name)).not.toContain('digest');
    });
});

describe('what must not throw', () => {
    test.each([
        ['an empty file', ''],
        ['a chart with no dependencies', 'apiVersion: v2\nname: bare\nversion: 0.1.0\n'],
        ['an empty dependencies list', 'apiVersion: v2\nname: bare\ndependencies: []\nversion: 0.1.0\n'],
    ])('%s', (_label, content) => {
        expect(chart.parse(content, 'Chart.yaml')).toEqual([]);
        expect(lock.parse(content, 'Chart.lock')).toEqual([]);
    });

    // A subchart with no version pinned at all: Helm allows it, and the row is
    // worth having with the version unknown rather than not at all.
    test('an entry with a name and no version', () => {
        const deps = chart.parse('dependencies:\n- name: common\n  repository: oci://x\n', 'Chart.yaml');

        expect(deps).toEqual([expect.objectContaining({ name: 'common', version: null })]);
    });
});
