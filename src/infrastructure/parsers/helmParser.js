import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse a Helm Chart.yaml.
 *
 * Constraints: a subchart is declared with a range (`7.x.x`, `~17.0.0`) and
 * Chart.lock records what that resolved to. helmLockParser.js reads the lock.
 *
 * Read line by line, as the rest of this directory does — no YAML parser in the
 * tree, and a `dependencies:` list is a fixed shape.
 */
export const manifestFiles = ['Chart.yaml'];

// A list item's keys are in no particular order. Bitnami's charts write them
// alphabetically, so the dash carries `condition:` and `name:` comes two lines
// later — matching on `- name:` finds nothing in the charts most people run.
const ITEM = /^(\s*)-\s+(.*)$/;
const FIELD = /^\s+([A-Za-z_][\w-]*):\s*(.*)$/;
const INLINE = /^([A-Za-z_][\w-]*):\s*(.*)$/;

/**
 * Rows for the entries of a `dependencies:` list, wherever it appears.
 *
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @param {string} [ecosystem]
 * @returns {Dependency[]}
 */
export function parseDependencyList(fileContent, manifestFileName, ecosystem = 'HELM') {
    const deps = [];
    let inSection = false;
    let itemIndent = null;
    let current = null;

    const unquote = value => value.trim().replace(/^["']|["']$/g, '');

    function readField(text) {
        const field = text.match(INLINE);
        if (field && current) current[field[1]] = unquote(field[2]);
    }

    function flush() {
        // An entry with no name is not a dependency — a `tags:` sub-list ends up
        // here otherwise, as an entry made of nothing.
        if (current?.name) {
            deps.push(new Dependency({
                ecosystem,
                name: current.name,
                version: current.version ?? null,
                manifestFile: manifestFileName,
            }));
        }
        current = null;
    }

    for (const line of fileContent.split('\n')) {
        if (!line.trim() || line.trim().startsWith('#')) continue;

        const item = line.match(ITEM);
        const atItemIndent = item && (itemIndent === null || item[1].length === itemIndent);

        // A line at column zero that does not open a list item ends the section.
        // That is what keeps the chart's own `name:` and `version:` out —
        // reading those would file every chart as depending on itself — and what
        // stops Chart.lock's trailing `digest:` and `generated:` being read.
        if (!/^\s/.test(line) && !atItemIndent) {
            flush();
            inSection = line.trim() === 'dependencies:';
            itemIndent = null;
            continue;
        }

        if (!inSection) continue;

        if (atItemIndent) {
            flush();
            itemIndent = item[1].length;
            current = {};
            readField(item[2]);
            continue;
        }

        // A dash deeper than the item indentation belongs to a nested list on
        // the entry being read — `tags:` is the one Helm actually writes.
        if (item) continue;

        const field = line.match(FIELD);
        // Everything else on an entry is `repository:`, `condition:` or
        // `alias:`, none of which is a version. Collected and ignored.
        if (field && current) current[field[1]] = unquote(field[2]);
    }

    flush();
    return deps;
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    return parseDependencyList(fileContent, manifestFileName);
}
