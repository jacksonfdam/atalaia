import { describe, test, expect } from '@jest/globals';

const parser = await import('#app/infrastructure/parsers/pipParser.js');

/**
 * Every tool that declares Python dependencies in pyproject.toml.
 *
 * The parser used to match one thing — `[project] dependencies` — and store
 * every entry with a null version, so a Poetry project scanned as empty and a
 * PEP 621 one reported `django>=4.2` as `django`, version unknown.
 *
 * Each fixture is trimmed from a real file, named where it came from.
 */

const read = (content, name = 'pyproject.toml') => {
    const deps = parser.parse(content, name);
    return Object.fromEntries(deps.map(d => [d.name, d.version]));
};

// Trimmed from psf/requests. PEP 621 plus PEP 735 groups.
const PEP_621 = `[project]
name = "requests"
description = "Python HTTP for Humans."
requires-python = ">=3.9"
dependencies = [
    "charset_normalizer>=2,<4",
    "idna>=2.5,<4",
    "certifi>=2023.5.7",
]
classifiers = [
    "Programming Language :: Python :: 3.9",
    "License :: OSI Approved :: Apache Software License",
]

[project.optional-dependencies]
socks = ["PySocks>=1.5.6, !=1.5.7"]
use_chardet_on_py3 = ["chardet>=3.0.2,<8"]

[dependency-groups]
tests = [
    "requests[socks]",
    "pytest>=8.0",
    {include-group = "typing"},
]
typing = ["typing_extensions"]
`;

// Trimmed from Textualize/rich. Poetry below 2.0: no [project] table at all.
const POETRY = `[tool.poetry]
name = "rich"
version = "13.9.4"
description = "Render rich text to the terminal"

[tool.poetry.dependencies]
python = ">=3.9.0"
pygments = "^2.13.0"
ipywidgets = { version = ">=7.5.1,<9", optional = true }
markdown-it-py = ">=2.2.0"
local_thing = { path = "../local_thing" }

[tool.poetry.extras]
jupyter = ["ipywidgets"]

[tool.poetry.group.dev.dependencies]
pytest = "^7.0.0"
mypy = "^1.11"

[tool.poetry.dev-dependencies]
attrs = "^21.4.0"
`;

// Trimmed from python-poetry/poetry: a direct reference and bracketed
// specifiers, both valid PEP 508 and both found in the wild.
const PEP_508_EDGES = `[project]
name = "poetry"
dependencies = [
    "poetry-core @ git+https://github.com/python-poetry/poetry-core.git",
    "build (>=1.2.1,<2.0.0)",
    "cachecontrol (>=0.14.0,<0.15.0)",
    "tomli>=1.1.0 ; python_version < '3.11'",
    "requests[security] >= 2.0",
]
`;

const PDM = `[project]
name = "app"
dependencies = ["flask>=3.0"]

[tool.pdm.dev-dependencies]
lint = ["ruff>=0.5.0"]
test = ["pytest>=8.0", "pytest-cov>=5.0"]
`;

const HATCH = `[project]
name = "app"
dependencies = ["httpx>=0.27"]

[tool.hatch.envs.default]
dependencies = ["coverage[toml]>=7.0"]

[tool.hatch.envs.docs]
extra-dependencies = ["mkdocs>=1.6"]

[tool.hatch.version]
path = "src/app/__about__.py"
`;

const UV = `[project]
name = "app"
dependencies = ["fastapi>=0.115"]

[dependency-groups]
dev = ["pytest>=8.3", "ruff>=0.6"]

[tool.uv]
package = true
`;

describe('PEP 621, the shape that was already read', () => {
    const deps = read(PEP_621);

    // Every one of these used to be stored with a null version.
    test('the constraint survives', () => {
        expect(deps['charset_normalizer']).toBe('>=2,<4');
        expect(deps['certifi']).toBe('>=2023.5.7');
    });

    test('an extra is a dependency too', () => {
        expect(deps['pysocks']).toBe('>=1.5.6,!=1.5.7');
        expect(deps['chardet']).toBe('>=3.0.2,<8');
    });

    test('a PEP 735 group is read', () => {
        expect(deps['pytest']).toBe('>=8.0');
        expect(deps['typing_extensions']).toBeNull();
    });

    // `{include-group = "typing"}` names a group, not a package.
    test('an included group is not a package', () => {
        expect(deps).not.toHaveProperty('typing');
    });

    // psf/requests really lists `requests[socks]` in its test group: an
    // editable self-install, not a dependency to advise about.
    test('the project does not depend on itself', () => {
        expect(deps).not.toHaveProperty('requests');
    });

    test('classifiers are not dependencies', () => {
        expect(Object.keys(deps).sort()).toEqual([
            'certifi',
            'chardet',
            'charset_normalizer',
            'idna',
            'pysocks',
            'pytest',
            'typing_extensions',
        ]);
    });
});

describe('Poetry', () => {
    const deps = read(POETRY);

    // Poetry below 2.0 writes no [project] table, so this whole file used to
    // scan as zero dependencies.
    test('the main dependencies are read', () => {
        expect(deps['pygments']).toBe('^2.13.0');
        expect(deps['markdown-it-py']).toBe('>=2.2.0');
    });

    test('a table value gives up its version', () => {
        expect(deps['ipywidgets']).toBe('>=7.5.1,<9');
    });

    test('a path dependency has no version to compare against', () => {
        expect(deps['local_thing']).toBeNull();
    });

    test('a group is read', () => {
        expect(deps['pytest']).toBe('^7.0.0');
        expect(deps['mypy']).toBe('^1.11');
    });

    test('the Poetry 1.0 dev-dependencies table is read', () => {
        expect(deps['attrs']).toBe('^21.4.0');
    });

    // The interpreter is constrained in the same table as the packages, and a
    // version lookup for it would go to PyPI asking about the language.
    test('python is not a package', () => {
        expect(deps).not.toHaveProperty('python');
    });

    test("the project's own name and version are not a dependency", () => {
        expect(deps).not.toHaveProperty('rich');
    });

    // [tool.poetry.extras] references dependencies declared above rather than
    // adding any, so reading it would count ipywidgets twice.
    test('an extras reference does not add a second row', () => {
        expect(parser.parse(POETRY, 'pyproject.toml').filter(d => d.name === 'ipywidgets')).toHaveLength(1);
    });
});

describe('PEP 508 forms that are not a version', () => {
    const deps = read(PEP_508_EDGES);

    test('a direct reference is a source, not a version', () => {
        expect(deps['poetry-core']).toBeNull();
    });

    test('a bracketed specifier loses its brackets', () => {
        expect(deps['build']).toBe('>=1.2.1,<2.0.0');
        expect(deps['cachecontrol']).toBe('>=0.14.0,<0.15.0');
    });

    test('an environment marker says when, not what', () => {
        expect(deps['tomli']).toBe('>=1.1.0');
    });

    test('an extra in the name is not part of the name', () => {
        expect(deps['requests']).toBe('>=2.0');
    });
});

describe('PDM', () => {
    const deps = read(PDM);

    test('every dev group is read', () => {
        expect(deps).toMatchObject({
            flask: '>=3.0',
            ruff: '>=0.5.0',
            pytest: '>=8.0',
            'pytest-cov': '>=5.0',
        });
    });
});

describe('Hatch', () => {
    const deps = read(HATCH);

    test('an environment contributes its dependencies', () => {
        expect(deps['coverage']).toBe('>=7.0');
        expect(deps['mkdocs']).toBe('>=1.6');
    });

    // [tool.hatch.version] has a `path` key and is not dependencies.
    test('the version table is not dependencies', () => {
        expect(Object.keys(deps).sort()).toEqual(['coverage', 'httpx', 'mkdocs']);
    });
});

describe('uv', () => {
    const deps = read(UV);

    test('reads PEP 735 groups and leaves the tool table alone', () => {
        expect(deps).toEqual({
            fastapi: '>=0.115',
            pytest: '>=8.3',
            ruff: '>=0.6',
        });
    });
});

describe('the other Python formats still work', () => {
    test('requirements.txt keeps extracting versions', () => {
        expect(read('django>=4.2\nrequests==2.31.0\n# a comment\n', 'requirements.txt')).toEqual({
            django: '>=4.2',
            requests: '==2.31.0',
        });
    });

    test('Pipfile keeps working', () => {
        expect(read('[packages]\ndjango = "==4.2"\n[dev-packages]\npytest = "*"\n', 'Pipfile')).toEqual({
            django: '==4.2',
            pytest: '*',
        });
    });
});

describe('what must not throw', () => {
    test.each([
        ['an empty file', ''],
        ['a file with no dependencies', '[project]\nname = "bare"\nversion = "1.0"\n'],
        ['an empty array', '[project]\nname = "bare"\ndependencies = []\n'],
        ['only a build system', '[build-system]\nrequires = ["hatchling"]\n'],
    ])('%s', (_label, content) => {
        expect(parser.parse(content, 'pyproject.toml')).toEqual([]);
    });
});
