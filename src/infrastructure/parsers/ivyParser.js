import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse an Apache Ivy ivy.xml.
 *
 * Genuinely legacy, and that is the argument for reading it: a repository still
 * on Ivy has no other dependency file, so this is the difference between an
 * empty scan and a real one. The coordinates are Maven's, so the rows are
 * `MAVEN` and the existing lookup answers about them.
 */
export const manifestFiles = ['ivy.xml'];

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const byName = new Map();

    // Attribute order is not fixed, so each is matched within one element rather
    // than in sequence.
    for (const element of fileContent.match(/<dependency\b[^>]*\/?>/g) ?? []) {
        const org = element.match(/\borg\s*=\s*"([^"]*)"/);
        const name = element.match(/\bname\s*=\s*"([^"]*)"/);
        if (!org || !name) continue;

        const coordinates = `${org[1]}:${name[1]}`;
        if (byName.has(coordinates)) continue;

        // `rev` is the revision. A dynamic one — `latest.integration`, `1.0.+` —
        // is a constraint like any other and stored as it stands; this file
        // never states what it resolved to.
        const revision = element.match(/\brev\s*=\s*"([^"]*)"/);

        byName.set(
            coordinates,
            new Dependency({
                ecosystem: 'MAVEN',
                name: coordinates,
                version: revision?.[1] || null,
                manifestFile: manifestFileName,
            })
        );
    }

    return [...byName.values()];
}
