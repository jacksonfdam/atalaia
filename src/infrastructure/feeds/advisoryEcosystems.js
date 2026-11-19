/**
 * Advisory databases name ecosystems their own way; dependencies carry Atalaia's.
 * One table, so a source added later maps itself here instead of inventing a
 * second spelling of NPM.
 *
 * GitHub's names, from the advisory API's `package.ecosystem`.
 */
const GITHUB = Object.freeze({
    npm: 'NPM',
    pip: 'PIP',
    rubygems: 'RUBYGEMS',
    go: 'GO',
    maven: 'MAVEN',
    nuget: 'NUGET',
    composer: 'COMPOSER',
    rust: 'CARGO',
    pub: 'PUB',
    erlang: 'HEX',
    swift: 'SWIFT',
    actions: 'GITHUB_ACTIONS',
});

/**
 * @param {string} name  GitHub's ecosystem name
 * @returns {string|null} null for one Atalaia does not scan (a range there could never be compared)
 */
export function fromGithubEcosystem(name) {
    return GITHUB[String(name ?? '').toLowerCase()] ?? null;
}
