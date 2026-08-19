import { describe, test, expect } from '@jest/globals';

const conda = await import('#app/infrastructure/parsers/condaParser.js');
const lock = await import('#app/infrastructure/parsers/condaLockParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');
const { Ecosystem } = await import('#app/domain/enums/Ecosystem.js');
const { supportsEcosystem, unsupportedReason } = await import('#app/infrastructure/registries/index.js');

// Trimmed from rll/rllab, which writes both = and == and has a nested pip list of
// twenty-six requirements.
const ENVIRONMENT_YML = `name: rllab3
channels:
    - https://conda.anaconda.org/kne
    - jjhelmus
dependencies:
    - python==3.5.2
    - numpy==1.12.0
    - scipy
    - opencv3=3.1.0
    - pytorch==0.1.9
    - numba=0.35=py36h0
    - pip
    - pip:
        - Pillow
        - atari-py
        - typing_extensions>=4.0
prefix: /opt/conda/envs/rllab3
`;

// Trimmed from 01-ai/Yi. Every entry says which manager installed it.
const CONDA_LOCK = `version: 1
metadata:
  content_hash:
    linux-64: fake
package:
- name: _libgcc_mutex
  version: '0.1'
  manager: conda
  platform: linux-64
  dependencies: {}
  url: https://conda.anaconda.org/conda-forge/linux-64/_libgcc_mutex-0.1-conda_forge.tar.bz2
  hash:
    md5: d7c89558ba9fa0495403155b64376d81
  category: main
  optional: false
- name: accelerate
  version: 0.24.1
  manager: conda
  platform: linux-64
  url: https://conda.anaconda.org/conda-forge/noarch/accelerate-0.24.1.conda
  category: main
- name: accelerate
  version: 0.24.1
  manager: conda
  platform: osx-arm64
  url: https://conda.anaconda.org/conda-forge/noarch/accelerate-0.24.1.conda
  category: main
- name: typing_extensions
  version: 4.8.0
  manager: pip
  platform: linux-64
  url: https://files.pythonhosted.org/packages/fake/typing_extensions-4.8.0-py3-none-any.whl
  category: main
`;

const rows = (parser, content, file) => parser.parse(content, file);
const byEcosystem = (parser, content, file, ecosystem) =>
    Object.fromEntries(
        rows(parser, content, file)
            .filter(d => d.ecosystem === ecosystem)
            .map(d => [d.name, d.version])
    );

describe('the ecosystem', () => {
    // pytorch on conda-forge is torch on PyPI, opencv is opencv-python. Filing a
    // Conda dependency as PIP would send every lookup and every correlation to
    // the wrong package, which is worse than not reading the file.
    test('CONDA is its own ecosystem', () => {
        expect(Ecosystem.CONDA).toBe('CONDA');
    });

    // anaconda.org answers per channel, and a repository pinning a channel other
    // than conda-forge would get an answer about a different build.
    test('it says why it has no version lookup', () => {
        expect(supportsEcosystem('CONDA')).toBe(false);
        expect(unsupportedReason('CONDA')).toMatch(/channel/);
    });
});

describe('discovery', () => {
    test.each([
        ['environment.yml', 1],
        ['environment.yaml', 1],
        ['conda-lock.yml', 1],
        ['envs/dev/environment.yml', 1],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });

    test('only the lock resolves versions', () => {
        expect(lock.resolvesVersions).toBe(true);
        expect(conda.resolvesVersions).toBeUndefined();
    });
});

describe('environment.yml', () => {
    const condaRows = byEcosystem(conda, ENVIRONMENT_YML, 'environment.yml', 'CONDA');
    const pipRows = byEcosystem(conda, ENVIRONMENT_YML, 'environment.yml', 'PIP');

    test('reads a conda pin written with ==', () => {
        expect(condaRows['numpy']).toBe('1.12.0');
        expect(condaRows['pytorch']).toBe('0.1.9');
    });

    // Conda's own spelling is a single =, and rllab's real file uses both.
    test('reads a conda pin written with a single =', () => {
        expect(condaRows['opencv3']).toBe('3.1.0');
    });

    // numba=0.35=py36h0 — the third field is a build string, not part of the
    // version.
    test('a build string is not part of the version', () => {
        expect(condaRows['numba']).toBe('0.35');
    });

    test('a bare name has no version', () => {
        expect(condaRows['scipy']).toBeNull();
    });

    // The nested list is real pip, PyPI names and all, and getting that split
    // right is most of the work in this parser.
    test('the nested pip list is PIP, not CONDA', () => {
        expect(Object.keys(pipRows).sort()).toEqual(['atari-py', 'pillow', 'typing-extensions']);
        expect(condaRows).not.toHaveProperty('Pillow');
    });

    test('a pip entry is PEP 503 normalised, as every other PIP row is', () => {
        expect(pipRows['typing-extensions']).toBe('>=4.0');
        expect(pipRows['pillow']).toBeNull();
    });

    describe('what is not a dependency', () => {
        test('python is the interpreter', () => {
            expect(condaRows).not.toHaveProperty('python');
        });

        // `- pip` on its own is the tool being installed, not a dependency.
        test('a bare pip entry is the tool', () => {
            expect(condaRows).not.toHaveProperty('pip');
        });

        test('the channels list', () => {
            expect(condaRows).not.toHaveProperty('jjhelmus');
            expect(Object.keys(condaRows)).toHaveLength(5);
        });

        test('the name and prefix fields', () => {
            expect(condaRows).not.toHaveProperty('rllab3');
        });
    });
});

describe('conda-lock.yml', () => {
    const all = rows(lock, CONDA_LOCK, 'conda-lock.yml');
    const byName = Object.fromEntries(all.map(d => [d.name, d]));

    // The manager field says which installed it, so the split is stated rather
    // than inferred from nesting the way environment.yml requires.
    test('the manager field decides the ecosystem', () => {
        expect(byName['accelerate'].ecosystem).toBe('CONDA');
        expect(byName['typing-extensions'].ecosystem).toBe('PIP');
    });

    // A version like '0.1' is quoted, because unquoted it would read as a number.
    test('a quoted version loses only the quotes', () => {
        expect(byName['_libgcc_mutex'].version).toBe('0.1');
    });

    // accelerate appears under linux-64 and osx-arm64. A three-platform lock
    // would otherwise triple every count the console shows.
    test('a package listed per platform is one row', () => {
        expect(all.filter(d => d.name === 'accelerate')).toHaveLength(1);
    });

    test('the url, hash and category fields are not packages', () => {
        expect(all).toHaveLength(3);
        expect(Object.keys(byName).sort()).toEqual([
            '_libgcc_mutex',
            'accelerate',
            'typing-extensions',
        ]);
    });
});

describe('what must not throw', () => {
    test.each([
        [conda, 'environment.yml', 'name: bare\nchannels:\n    - conda-forge\n'],
        [conda, 'environment.yml', ''],
        [lock, 'conda-lock.yml', 'version: 1\npackage: []\n'],
        [lock, 'conda-lock.yml', ''],
    ])('%#', (parser, file, content) => {
        expect(parser.parse(content, file)).toEqual([]);
    });
});
