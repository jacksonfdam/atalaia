/**
 * Port interface for dependency file parsers.
 * Each parser handles one or more manifest file types (package.json, requirements.txt, etc.).
 */
export class DependencyParserPort {
    /**
     * File names or patterns this parser can handle.
     * Used to match against the file tree from a repository scan.
     * @returns {string[]} e.g. ['package.json'] or ['requirements.txt', 'Pipfile']
     */
    get manifestFiles() {
        throw new Error('DependencyParserPort.manifestFiles not implemented');
    }

    /**
     * Parse file content and extract dependencies.
     * @param {string} fileContent - Raw file content as string
     * @param {string} manifestFileName - The actual file name (for disambiguation)
     * @returns {import('../entities/Dependency.js').default[]}
     */
    parse(fileContent, manifestFileName) {
        throw new Error('DependencyParserPort.parse() not implemented');
    }
}
