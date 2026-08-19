import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse OCaml dependency declarations.
 *
 * Two syntaxes for the same thing. An opam file lists `depends: [ "dune" {>= "3.18"} ]`;
 * a dune-project lists `(depends (csexp (>= 1.5.0)))` in s-expressions, and dune
 * generates the opam files from it.
 */
export const manifestFiles = ['opam', 'dune-project'];

/** @param {string} filePath */
export function matchesFile(filePath) {
    // A repository conventionally names the file after the package —
    // `lwt.opam`, `dune.opam` — as well as, or instead of, a bare `opam`.
    return filePath.endsWith('.opam');
}

/**
 * The compiler, not a package. It is constrained in the same list as the
 * dependencies, the same way `python` is under a Poetry table.
 */
const NOT_A_PACKAGE = new Set(['ocaml']);

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    // Anything that is not a dune-project is opam syntax, which includes an
    // opam.locked — opamLockParser.js reads that one through here.
    return manifestFileName.split('/').pop() === 'dune-project'
        ? fromDuneProject(fileContent, manifestFileName)
        : fromOpam(fileContent, manifestFileName);
}

function collector(manifestFileName) {
    const byName = new Map();

    return {
        add(name, version) {
            if (!name || NOT_A_PACKAGE.has(name) || byName.has(name)) return;

            byName.set(
                name,
                new Dependency({
                    ecosystem: 'OPAM',
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
 * An opam file.
 *
 * `depends: [ "dune" {>= "3.18"} "ocplib-endian" ]`. The constraint sits in
 * braces after the name and can carry build markers alongside it — lwt writes
 * `"cppo" {build & >= "1.1"}` — so only the comparison part is a version.
 *
 * `depopts:` beside it lists optional dependencies, which are real dependencies
 * when present but carry no constraint at all in that list.
 */
function fromOpam(content, manifestFileName) {
    const out = collector(manifestFileName);

    for (const field of ['depends', 'depopts']) {
        // The list can be written across lines or on one, so it is found whole.
        const block = content.match(new RegExp(`^${field}\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'm'));
        if (!block) continue;

        // "name" optionally followed by { … } holding the constraint.
        for (const entry of block[1].matchAll(/"([^"]+)"\s*(\{[^}]*\})?/g)) {
            out.add(entry[1], constraintIn(entry[2]));
        }
    }

    return out.rows();
}

/**
 * The version out of an opam constraint expression.
 *
 * `{>= "3.18"}` is a version; `{build & >= "1.1"}` is a build marker and a
 * version; `{with-doc & >= "2.3"}` likewise; `{dev}` is a marker alone and pins
 * nothing.
 *
 * @param {string|undefined} braces
 * @returns {string|null}
 */
function constraintIn(braces) {
    if (!braces) return null;

    const comparison = braces.match(/(=|>=|<=|>|<|!=)\s*"([^"]+)"/);
    return comparison ? `${comparison[1]} ${comparison[2]}` : null;
}

/**
 * A dune-project.
 *
 * S-expressions: `(depends ocaml dune (csexp (>= 1.5.0)))`. A bare atom is a
 * dependency with no constraint; a parenthesised pair carries one. Depth
 * tracking on brackets is enough — dune's own file has comment lines inside the
 * depends form, and several `(package …)` stanzas each with their own.
 */
function fromDuneProject(content, manifestFileName) {
    const out = collector(manifestFileName);

    // Strip comments first: a dune comment runs from a semicolon to end of line,
    // and dune's own dune-project has a three-line one inside a depends form.
    const source = content.replace(/;[^\n]*/g, '');

    let index = 0;
    while (index < source.length) {
        const start = source.indexOf('(depends', index);
        if (start < 0) break;

        const end = closingBracket(source, start);
        readDependsForm(source.slice(start + '(depends'.length, end), out);
        index = end;
    }

    return out.rows();
}

/** The index just past the bracket that closes the one at `start`. */
function closingBracket(source, start) {
    let depth = 0;

    for (let index = start; index < source.length; index += 1) {
        if (source[index] === '(') depth += 1;
        else if (source[index] === ')') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }

    return source.length;
}

/** The entries of a `(depends …)` form. */
function readDependsForm(body, out) {
    let index = 0;

    while (index < body.length) {
        const character = body[index];

        if (character === '(') {
            const end = closingBracket(body, index);
            // (csexp (>= 1.5.0)) — the atom is the name, the nested form the
            // constraint.
            const inner = body.slice(index + 1, end);
            const named = inner.match(/^\s*([A-Za-z][\w.-]*)\s*(.*)$/s);
            if (named) {
                const comparison = named[2].match(/(=|>=|<=|>|<|<>)\s*([\w.]+)/);
                out.add(named[1], comparison ? `${comparison[1]} ${comparison[2]}` : null);
            }
            index = end + 1;
            continue;
        }

        const atom = body.slice(index).match(/^\s*([A-Za-z][\w.-]*)/);
        if (atom) {
            out.add(atom[1], null);
            index += atom[0].length;
            continue;
        }

        index += 1;
    }
}
