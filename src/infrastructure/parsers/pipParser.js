import Dependency from '../../domain/entities/Dependency.js';
import { isConstraintTable, isPackage, isRequirementArray } from './pyprojectSections.js';

/**
 * Parse Python dependency files: requirements.txt, Pipfile, pyproject.toml.
 */
export const manifestFiles = ['requirements.txt', 'requirements-dev.txt', 'requirements_dev.txt', 'Pipfile', 'pyproject.toml', 'setup.py', 'setup.cfg'];

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    if (manifestFileName === 'Pipfile') return parsePipfile(fileContent, manifestFileName);
    if (manifestFileName === 'pyproject.toml') return parsePyproject(fileContent, manifestFileName);
    return parseRequirements(fileContent, manifestFileName);
}

function parseRequirements(content, manifestFileName) {
    const deps = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;

        // Match: package==1.0, package>=1.0, package~=1.0, package
        const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*(?:\[.*?\])?\s*([><=!~]+\s*[\d.]+(?:\s*,\s*[><=!~]+\s*[\d.]+)*)?/);
        if (match) {
            deps.push(new Dependency({
                ecosystem: 'PIP',
                name: match[1].toLowerCase(),
                version: match[2] ? match[2].trim() : null,
                manifestFile: manifestFileName,
            }));
        }
    }
    return deps;
}

function parsePipfile(content, manifestFileName) {
    const deps = [];
    let inSection = false;

    for (const line of content.split('\n')) {
        const trimmed = line.trim();

        if (trimmed === '[packages]' || trimmed === '[dev-packages]') {
            inSection = true;
            continue;
        }
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            inSection = false;
            continue;
        }

        if (inSection) {
            const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*=/);
            if (match) {
                // Extract version from the value
                const versionMatch = trimmed.match(/=\s*"([^"]+)"/);
                deps.push(new Dependency({
                    ecosystem: 'PIP',
                    name: match[1].toLowerCase(),
                    version: versionMatch ? versionMatch[1] : null,
                    manifestFile: manifestFileName,
                }));
            }
        }
    }
    return deps;
}

/**
 * Split a PEP 508 requirement string into a name and a specifier.
 *
 * `django>=4.2`, `requests[security] >= 2.0`, and
 * `tomli>=1.1.0 ; python_version < "3.11"` all have to come apart the same way
 * requirements.txt entries already do, so the two paths agree about a version.
 *
 * @param {string} spec
 * @returns {{ name: string, version: string|null }|null}
 */
function splitRequirement(spec) {
    // An environment marker says when the requirement applies, not what it is.
    const requirement = spec.split(';')[0].trim();
    const parts = requirement.match(/^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(.*)$/);
    if (!parts) return null;

    // Whitespace inside a specifier is cosmetic: `>= 2.0` and `>=2.0` are the
    // same constraint, and storing both spellings makes them look different.
    const specifier = parts[2].replace(/\s+/g, '');

    // A direct reference — `poetry-core @ git+https://...`, which python-poetry
    // uses on itself — names a source, not a version. Nothing to compare a URL
    // against, so it reports unknown.
    if (specifier.startsWith('@')) return { name: parts[1].toLowerCase(), version: null };

    // PEP 508 allows the specifier in brackets: `build (>=1.2.1,<2.0.0)`. The
    // brackets are syntax, and leaving them in makes the version uncomparable.
    const version = specifier.replace(/^\((.*)\)$/, '$1') || null;
    return { name: parts[1].toLowerCase(), version };
}

/**
 * The requirement strings in a TOML array.
 *
 * Inline tables are dropped first: a PEP 735 group can reference another group
 * with `{include-group = "test"}`, and the quoted name inside that is a group,
 * not a package.
 *
 * @param {string} text
 * @returns {string[]}
 */
function requirementStrings(text) {
    return (text.replace(/\{[^}]*\}/g, '').match(/"([^"]*)"|'([^']*)'/g) ?? []).map(quoted =>
        quoted.slice(1, -1)
    );
}

/**
 * The line with its quoted strings removed, for looking at TOML punctuation.
 *
 * A requirement can carry an extra — `requests[socks]` — and its bracket closed
 * the array a line early, so everything after the first entry went unread.
 */
function outsideStrings(line) {
    return line.replace(/"[^"]*"|'[^']*'/g, '');
}

/** The constraint out of a Poetry value, which may be a string or a table. */
function poetryConstraint(value) {
    const trimmed = value.trim();

    if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
        return trimmed.slice(1, -1).replace(/\s+/g, '') || null;
    }

    // { version = "^4.2", optional = true }. A `path`, `git` or `url` entry has
    // no published version to compare against, and says so by having no
    // `version` key at all.
    const version = trimmed.match(/version\s*=\s*["']([^"']+)["']/);
    return version ? version[1].replace(/\s+/g, '') : null;
}

/**
 * The name of the project the file describes, lowercased.
 *
 * Read ahead of everything else because a `[project]` table does not have to
 * come before the group that names it.
 *
 * @param {string} content
 * @returns {string|null}
 */
function projectName(content) {
    let table = '';

    for (const raw of content.split('\n')) {
        const line = raw.trim();
        const header = line.match(/^\[+([^\]]+)\]+$/);
        if (header) {
            table = header[1].trim();
            continue;
        }
        if (table !== 'project' && table !== 'tool.poetry') continue;

        const name = line.match(/^name\s*=\s*["']([^"']+)["']/);
        if (name) return name[1].toLowerCase();
    }

    return null;
}

/**
 * Read every table of a pyproject.toml that declares dependencies.
 *
 * Line by line, as gradleCatalogParser.js reads its TOML — there is no TOML
 * parser in the dependency tree and this does not justify adding one.
 */
function parsePyproject(content, manifestFileName) {
    const byName = new Map();
    const own = projectName(content);
    let table = '';
    let openArray = null;

    const add = (name, version) => {
        if (!name || !isPackage(name)) return;

        const key = name.toLowerCase();

        // A project lists itself, with an extra, in a dev group: psf/requests
        // has `requests[socks]` under its test dependencies. That is an
        // editable self-install, not a dependency to advise about.
        if (key === own) return;

        // The same package can be declared in several tables — a Poetry main
        // dependency that is also a Hatch environment's, an extra that repeats
        // a base requirement. One row per package, or the Dependencies tab
        // lists it once per table it appears in. A later declaration fills in a
        // version the first one did not carry.
        const existing = byName.get(key);
        if (existing) {
            if (!existing.version && version) existing.version = version;
            return;
        }

        byName.set(key, new Dependency({
            ecosystem: 'PIP',
            name: key,
            version: version || null,
            manifestFile: manifestFileName,
        }));
    };

    const addRequirements = text => {
        for (const spec of requirementStrings(text)) {
            const requirement = splitRequirement(spec);
            if (requirement) add(requirement.name, requirement.version);
        }
    };

    for (const raw of content.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;

        // Inside a multi-line array, until its closing bracket.
        if (openArray !== null) {
            if (openArray) addRequirements(line);
            if (outsideStrings(line).includes(']')) openArray = null;
            continue;
        }

        const header = line.match(/^\[+([^\]]+)\]+$/);
        if (header) {
            table = header[1].trim();
            continue;
        }

        const assignment = line.match(/^["']?([A-Za-z0-9._-]+)["']?\s*=\s*(.*)$/);
        if (!assignment) continue;

        const [, key, value] = assignment;

        if (value.startsWith('[')) {
            const wanted = isRequirementArray(table, key);
            if (wanted) addRequirements(value);
            // A single-line array closes on the same line; anything else opens.
            if (!outsideStrings(value).includes(']')) openArray = wanted;
            continue;
        }

        if (isConstraintTable(table)) add(key.toLowerCase(), poetryConstraint(value));
    }

    return [...byName.values()];
}
