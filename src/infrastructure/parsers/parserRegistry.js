import * as npmParser from './npmParser.js';
import * as pipParser from './pipParser.js';
import * as goParser from './goParser.js';
import * as dockerParser from './dockerParser.js';
import * as cargoParser from './cargoParser.js';
import * as mavenParser from './mavenParser.js';
import * as gradleParser from './gradleParser.js';
import * as gradleCatalogParser from './gradleCatalogParser.js';
import * as rubyParser from './rubyParser.js';
import * as composerParser from './composerParser.js';
import * as nugetParser from './nugetParser.js';
import * as terraformParser from './terraformParser.js';
import * as githubActionsParser from './githubActionsParser.js';
import * as swiftParser from './swiftParser.js';
import * as cocoapodsParser from './cocoapodsParser.js';
import * as pubParser from './pubParser.js';
import * as pubLockParser from './pubLockParser.js';
import * as helmParser from './helmParser.js';
import * as helmLockParser from './helmLockParser.js';
import * as npmLockParser from './npmLockParser.js';
import * as pipLockParser from './pipLockParser.js';
import * as composerLockParser from './composerLockParser.js';
import * as gemLockParser from './gemLockParser.js';
import * as cargoLockParser from './cargoLockParser.js';

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
    gradleCatalogParser,
    rubyParser,
    composerParser,
    nugetParser,
    terraformParser,
    githubActionsParser,
    swiftParser,
    cocoapodsParser,
    pubParser,
    pubLockParser,
    helmParser,
    helmLockParser,
    npmLockParser,
    pipLockParser,
    composerLockParser,
    gemLockParser,
    cargoLockParser,
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
