/**
 * Dependency ecosystem types, representing package managers and infra tools.
 */
export const Ecosystem = Object.freeze({
    NPM: 'NPM',
    PIP: 'PIP',
    GO: 'GO',
    CARGO: 'CARGO',
    MAVEN: 'MAVEN',
    GRADLE: 'GRADLE',
    RUBYGEMS: 'RUBYGEMS',
    NUGET: 'NUGET',
    COMPOSER: 'COMPOSER',
    DOCKER: 'DOCKER',
    // CI workflows pin third-party actions by tag, and a tag is a moving
    // target: a pipeline is as exposed as anything it runs.
    GITHUB_ACTIONS: 'GITHUB_ACTIONS',
    TERRAFORM: 'TERRAFORM',
    HELM: 'HELM',
    COCOAPODS: 'COCOAPODS',
    PUB: 'PUB',
    SWIFT: 'SWIFT',
    UNKNOWN: 'UNKNOWN',
});

/**
 * @param {string} ecosystem
 * @returns {boolean}
 */
export function isValidEcosystem(ecosystem) {
    return Object.values(Ecosystem).includes(ecosystem);
}

/**
 * Normalize ecosystem string to uppercase enum value.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeEcosystem(raw) {
    if (!raw || typeof raw !== 'string') return Ecosystem.UNKNOWN;
    const upper = raw.toUpperCase();
    return isValidEcosystem(upper) ? upper : Ecosystem.UNKNOWN;
}
