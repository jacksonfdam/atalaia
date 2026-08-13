import { describe, test, expect } from '@jest/globals';

const parser = await import('#app/infrastructure/parsers/githubActionsParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');

const WORKFLOW = `
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    container:
      image: node:18-alpine
    services:
      postgres:
        image: postgres:13.2
    steps:
      - uses: actions/checkout@v3
      - uses: "actions/setup-node@v4.0.1"
      - uses: docker://alpine:3.14
      - uses: ./.github/actions/local
      - uses: github/codeql-action/analyze@f1a2b3c4d5e6
      # - uses: commented/out@v1
      - uses: actions/checkout@v3
      - run: npm ci
  matrix:
    container:
      image: \${{ matrix.image }}
`;

describe('workflow discovery', () => {
    test.each([
        ['.github/workflows/ci.yml', 1],
        ['.github/workflows/release.yaml', 1],
        ['action.yml', 1],
        ['.github/actions/setup/action.yaml', 1],
        ['README.md', 0],
        ['src/config.yml', 0],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });
});

describe('githubActionsParser', () => {
    const deps = parser.parse(WORKFLOW, 'ci.yml');
    const actions = deps.filter(d => d.ecosystem === 'GITHUB_ACTIONS');
    const images = deps.filter(d => d.ecosystem === 'DOCKER');

    test('extracts third-party actions with their ref', () => {
        expect(actions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'actions/checkout', version: 'v3' }),
                expect.objectContaining({ name: 'actions/setup-node', version: 'v4.0.1' }),
            ])
        );
    });

    test('reduces a sub-path action to the repository that owns it', () => {
        expect(actions).toContainEqual(
            expect.objectContaining({ name: 'github/codeql-action', version: 'f1a2b3c4d5e6' })
        );
    });

    test('records job and service container images', () => {
        expect(images).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'node', version: '18-alpine' }),
                expect.objectContaining({ name: 'postgres', version: '13.2' }),
                expect.objectContaining({ name: 'alpine', version: '3.14' }),
            ])
        );
    });

    test('skips local actions, comments and runtime expressions', () => {
        const names = deps.map(d => d.name);

        expect(names).not.toContain('./.github/actions/local');
        expect(names).not.toContain('commented/out');
        expect(names.some(name => name.includes('${{'))).toBe(false);
    });

    test('deduplicates a repeated action', () => {
        expect(actions.filter(d => d.name === 'actions/checkout')).toHaveLength(1);
    });

    test('handles an action with no ref at all', () => {
        const [dep] = parser.parse('    - uses: actions/stale\n', 'ci.yml');
        expect(dep).toMatchObject({ name: 'actions/stale', version: null });
    });

    test('keeps a registry port out of the image tag', () => {
        const [dep] = parser.parse('    image: registry.example.com:5000/team/api:2.1\n', 'ci.yml');
        expect(dep).toMatchObject({ name: 'registry.example.com:5000/team/api', version: '2.1' });
    });

    test('reads a digest-pinned image', () => {
        const [dep] = parser.parse('    image: alpine@sha256:abc123\n', 'ci.yml');
        expect(dep).toMatchObject({ name: 'alpine', version: 'sha256:abc123' });
    });
});
