import * as npmParser from './npmParser.js';
import * as pipParser from './pipParser.js';
import * as goParser from './goParser.js';
import * as dockerParser from './dockerParser.js';
import * as cargoParser from './cargoParser.js';
import * as mavenParser from './mavenParser.js';
import * as gradleParser from './gradleParser.js';
import * as rubyParser from './rubyParser.js';
import * as composerParser from './composerParser.js';
import * as nugetParser from './nugetParser.js';
import * as terraformParser from './terraformParser.js';

/**
 * All registered dependency parsers.
 * Each has: manifestFiles (string[]), parse(content, fileName) → Dependency[],
 * and optionally matchesFile(filePath) for extension-based matching.
 */
export const parsers = [
    npmParser,
    pipParser,
    goParser,
    dockerParser,
    cargoParser,
    mavenParser,
    gradleParser,
    rubyParser,
    composerParser,
    nugetParser,
    terraformParser,
];

/**
 * Find all parsers that can handle a given file path.
 * Checks exact filename match first, then extension-based matchesFile() if available.
 *
 * @param {string} filePath - e.g. "src/backend/pom.xml" or "MyApp.csproj"
 * @returns {{ parser: object, manifestFileName: string }[]}
 */
export function findParsersForFile(filePath) {
    const fileName = filePath.split('/').pop();
    const matches = [];

    for (const parser of parsers) {
        // Exact filename match
        if (parser.manifestFiles.includes(fileName)) {
            matches.push({ parser, manifestFileName: fileName });
            continue;
        }

        // Extension-based match (for .csproj, .tf, etc.)
        if (parser.matchesFile && parser.matchesFile(filePath)) {
            matches.push({ parser, manifestFileName: fileName });
        }
    }

    return matches;
}

/**
 * Get all manifest filenames and extensions that parsers look for.
 * Useful for filtering the file tree before fetching content.
 * @returns {string[]}
 */
export function getAllManifestPatterns() {
    const patterns = new Set();
    for (const parser of parsers) {
        for (const f of parser.manifestFiles) {
            patterns.add(f);
        }
    }
    return [...patterns];
}
