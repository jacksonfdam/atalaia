import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse a build.zig.zon.
 *
 * ZON is Zig Object Notation, the same shape as an anonymous struct literal.
 * A dependency is identified by a URL and a content hash rather than by a
 * version, which makes this the one parser here whose main product is a name.
 *
 * There is one place a version survives, though, and it took reading a real file
 * to find: since Zig 0.14 the `hash` field is `<name>-<version>-<digest>`, so
 * `"clap-0.11.0-oBajB7foAQC3Iyn4IVCkUdYaOVVng5IZkSncySTjNig1"` does state 0.11.0.
 * Where that is present it is read; where it is not, the row is a name with the
 * version unknown, which is the correct answer rather than a gap.
 */
export const manifestFiles = ['build.zig.zon'];

// A dependency entry: `.clap = .{`.
const ENTRY = /\.([A-Za-z_][\w]*)\s*=\s*\.\{/g;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const start = fileContent.indexOf('.dependencies');
    if (start < 0) return [];

    const open = fileContent.indexOf('{', start);
    if (open < 0) return [];

    // Only inside the dependencies struct. The file's own `.name`, `.version`,
    // `.fingerprint` and `.minimum_zig_version` sit outside it — reading those
    // would file every project as depending on itself — and so does `.paths`,
    // which is a list of directories in the repository.
    const body = fileContent.slice(open + 1, closingBrace(fileContent, open));
    const byName = new Map();

    for (const entry of body.matchAll(ENTRY)) {
        const name = entry[1];
        if (byName.has(name)) continue;

        const from = entry.index + entry[0].length - 1;
        const fields = body.slice(from + 1, closingBrace(body, from));
        const hash = fields.match(/\.hash\s*=\s*"([^"]+)"/);

        byName.set(
            name,
            new Dependency({
                ecosystem: 'ZIG',
                name,
                version: versionInHash(hash?.[1]),
                manifestFile: manifestFileName,
            })
        );
    }

    return [...byName.values()];
}

/** The index of the brace that closes the one at `open`. */
function closingBrace(source, open) {
    let depth = 0;

    for (let index = open; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }

    return source.length;
}

/**
 * The version out of a Zig 0.14-style hash, `<name>-<version>-<digest>`.
 *
 * Scanned left to right for the first segment shaped like a version, not taken
 * by position: both halves around it can hold dashes. ly's own file has
 * `zlua-0.1.0-hGRpC2aABQD4D9PBVH3wAW8k32-I4969MRQ0CpOwoley`, where the digest
 * splits into two segments, and a package whose name contains a dash pushes the
 * version further right. Since the version always precedes the digest, the first
 * match is it.
 *
 * An older hash — `1220abc…` — has no version in it at all.
 *
 * @param {string|undefined} hash
 * @returns {string|null}
 */
function versionInHash(hash) {
    if (!hash) return null;

    for (const segment of hash.split('-').slice(1)) {
        if (/^\d[\d.]*$/.test(segment)) return segment;
    }

    return null;
}
