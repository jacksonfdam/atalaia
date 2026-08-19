import Dependency from '../../domain/entities/Dependency.js';
import { normalizePythonName } from './pythonNames.js';

/**
 * Parse a Conda environment.yml.
 *
 * Its own ecosystem, not PIP. Conda resolves from its own channels and the two
 * disagree about names — `pytorch` on conda-forge is `torch` on PyPI, `opencv` is
 * `opencv-python` — so filing a Conda dependency as PIP would send every version
 * lookup and every CVE correlation to the wrong package. A wrong answer is worse
 * than not reading the file, because it reads as an answer.
 *
 * The nested `pip:` list is the exception: those really are PyPI names.
 */
export const manifestFiles = ['environment.yml', 'environment.yaml'];

/** The interpreter and the tool, neither of which is a dependency. */
const NOT_A_PACKAGE = new Set(['python', 'pip']);

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const rows = [];
    const seen = new Set();
    let inDependencies = false;
    let pipIndent = null;

    const add = (ecosystem, spec) => {
        const split = splitSpec(spec);
        if (!split) return;

        const name = ecosystem === 'PIP' ? normalizePythonName(split.name) : split.name;
        if (NOT_A_PACKAGE.has(name.toLowerCase())) return;

        const key = `${ecosystem} ${name}`;
        if (seen.has(key)) return;
        seen.add(key);

        rows.push(
            new Dependency({
                ecosystem,
                name,
                version: split.version,
                manifestFile: manifestFileName,
            })
        );
    };

    for (const raw of fileContent.split('\n')) {
        if (!raw.trim() || raw.trim().startsWith('#')) continue;

        // `channels:`, `dependencies:`, `name:`, `prefix:` all sit at column zero.
        if (!/^\s/.test(raw)) {
            inDependencies = raw.trim() === 'dependencies:';
            pipIndent = null;
            continue;
        }

        if (!inDependencies) continue;

        const indent = raw.length - raw.trimStart().length;
        const item = raw.trim();

        // `- pip:` opens a nested list of PyPI requirements. It ends when the
        // indentation comes back to the level of the `pip:` item itself.
        if (/^-\s*pip\s*:\s*$/.test(item)) {
            pipIndent = indent;
            continue;
        }

        if (pipIndent !== null && indent <= pipIndent) pipIndent = null;

        const entry = item.match(/^-\s+(.+)$/);
        if (!entry) continue;

        add(pipIndent === null ? 'CONDA' : 'PIP', entry[1].trim());
    }

    return rows;
}

/**
 * Split a spec into a name and a version.
 *
 * Conda writes a single `=` — `opencv3=3.1.0` — and accepts `==` as well;
 * rll/rllab's real file uses both. A pip entry inside the nested list is PEP 508,
 * `Pillow>=9.0`.
 *
 * @param {string} spec
 * @returns {{ name: string, version: string|null }|null}
 */
function splitSpec(spec) {
    const bare = spec.split(/\s/)[0];
    const split = bare.match(/^([A-Za-z0-9._-]+)([=<>!~]+)?(.*)$/);
    if (!split) return null;

    const [, name, operator, rest] = split;
    if (!operator) return { name, version: null };

    // Conda's own separator is `=`, and it allows a build string as a third
    // field: numba=0.35=py36h0. The build is not part of the version.
    if (operator === '=' || operator === '==') {
        return { name, version: rest.split('=')[0].trim() || null };
    }

    // Anything else is a comparison — `typing_extensions>=4.0` in the nested pip
    // list — and the operator is part of the constraint, as pipParser stores it.
    // Splitting on `=` here would cut `>=4.0` down to `>`.
    return { name, version: `${operator}${rest}`.trim() || null };
}
