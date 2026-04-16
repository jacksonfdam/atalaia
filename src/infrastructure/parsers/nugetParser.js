import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse .NET project files (.csproj, .fsproj, .vbproj) for NuGet dependencies.
 */
export const manifestFiles = ['.csproj', '.fsproj', '.vbproj'];

/**
 * Check if a file path matches this parser's patterns.
 * Uses endsWith since .csproj files have variable names.
 * @param {string} filePath
 * @returns {boolean}
 */
export function matchesFile(filePath) {
    return manifestFiles.some(ext => filePath.endsWith(ext));
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];
    const seen = new Set();

    // Match <PackageReference Include="Name" Version="1.0" />
    const regex = /<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g;
    let match;

    while ((match = regex.exec(fileContent)) !== null) {
        const name = match[1];
        if (seen.has(name)) continue;
        seen.add(name);

        deps.push(new Dependency({
            ecosystem: 'NUGET',
            name,
            version: match[2] || null,
            manifestFile: manifestFileName,
        }));
    }

    return deps;
}
