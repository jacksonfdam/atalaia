import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse Terraform files for provider and module dependencies.
 */
export const manifestFiles = ['.tf'];

/**
 * Check if a file path matches Terraform files.
 * @param {string} filePath
 * @returns {boolean}
 */
export function matchesFile(filePath) {
    return filePath.endsWith('.tf');
}

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const deps = [];
    const seen = new Set();

    // Match required_providers block
    const providersBlock = fileContent.match(/required_providers\s*\{([\s\S]*?)\}/);
    if (providersBlock) {
        // Match provider entries: aws = { source = "hashicorp/aws", version = "~> 5.0" }
        const providerRegex = /(\w+)\s*=\s*\{[\s\S]*?source\s*=\s*"([^"]+)"[\s\S]*?(?:version\s*=\s*"([^"]+)")?[\s\S]*?\}/g;
        let match;

        while ((match = providerRegex.exec(providersBlock[1])) !== null) {
            const name = match[2]; // e.g. "hashicorp/aws"
            if (seen.has(name)) continue;
            seen.add(name);

            deps.push(new Dependency({
                ecosystem: 'TERRAFORM',
                name,
                version: match[3] || null,
                manifestFile: manifestFileName,
            }));
        }
    }

    // Match module blocks: module "name" { source = "..." }
    const moduleRegex = /module\s+"([^"]+)"\s*\{[\s\S]*?source\s*=\s*"([^"]+)"[\s\S]*?(?:version\s*=\s*"([^"]+)")?[\s\S]*?\}/g;
    let match;

    while ((match = moduleRegex.exec(fileContent)) !== null) {
        const name = match[2];
        if (seen.has(name)) continue;
        seen.add(name);

        deps.push(new Dependency({
            ecosystem: 'TERRAFORM',
            name,
            version: match[3] || null,
            manifestFile: manifestFileName,
        }));
    }

    return deps;
}
