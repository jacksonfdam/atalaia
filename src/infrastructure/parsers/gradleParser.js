import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Gradle build files (build.gradle, build.gradle.kts) for dependencies.
 */
export const manifestFiles = ['build.gradle', 'build.gradle.kts'];

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];
    const seen = new Set();

    // Match Groovy string notation: implementation 'group:artifact:version'
    const groovyRegex = /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|classpath)\s*['"]([\w.-]+):([\w.-]+)(?::([\w.+-]+))?['"]/g;
    let match;

    while ((match = groovyRegex.exec(fileContent)) !== null) {
        const name = `${match[1]}:${match[2]}`;
        if (seen.has(name)) continue;
        seen.add(name);

        deps.push(new Dependency({
            ecosystem: 'GRADLE',
            name,
            version: match[3] || null,
            manifestFile: manifestFileName,
        }));
    }

    // Match Kotlin DSL: implementation("group:artifact:version")
    const kotlinRegex = /(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|classpath)\s*\(\s*"([\w.-]+):([\w.-]+)(?::([\w.+-]+))?"\s*\)/g;

    while ((match = kotlinRegex.exec(fileContent)) !== null) {
        const name = `${match[1]}:${match[2]}`;
        if (seen.has(name)) continue;
        seen.add(name);

        deps.push(new Dependency({
            ecosystem: 'GRADLE',
            name,
            version: match[3] || null,
            manifestFile: manifestFileName,
        }));
    }

    return deps;
}
