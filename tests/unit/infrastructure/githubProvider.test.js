/**
 * The GitHub integration must stay read-only.
 *
 * Two guarantees are checked: the module contains no write call at all, and
 * every method that talks to GitHub goes through the single GET helper.
 */
import { describe, test, expect, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const PROVIDER_PATH = path.resolve(
    path.dirname(__filename),
    '../../../src/infrastructure/providers/githubProvider.js'
);

const { GitHubProvider, parseGitHubUrl } = await import('#app/infrastructure/providers/githubProvider.js');

describe('GitHubProvider is read-only', () => {
    test('the module contains no write call', () => {
        const source = fs.readFileSync(PROVIDER_PATH, 'utf-8');

        expect(source).not.toMatch(/axios\.(post|put|patch|delete)/);
        expect(source).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    });

    test('every request goes through the GET helper', async () => {
        const provider = new GitHubProvider('token', 'acme');
        const calls = [];

        provider._get = async (url, params) => {
            calls.push({ url, params });
            if (url.endsWith('/languages')) return { TypeScript: 10 };
            if (url.includes('/git/trees/')) return { tree: [{ type: 'blob', path: 'package.json' }] };
            if (url.includes('/contents/')) return { encoding: 'base64', content: Buffer.from('{}').toString('base64') };
            return [];
        };

        await provider.listRepositories('acme');
        await provider.listLanguages('https://github.com/acme/api');
        await provider.listFiles('https://github.com/acme/api', 'main');
        await provider.getFileContent('https://github.com/acme/api', 'package.json');

        expect(calls).toHaveLength(4);
        expect(calls.every(call => call.url.startsWith('https://api.github.com/'))).toBe(true);
    });
});

describe('repository mapping', () => {
    test('an archived repository is imported switched off', () => {
        const provider = new GitHubProvider('token', 'acme');

        const repo = provider._toRepository({
            full_name: 'acme/legacy',
            html_url: 'https://github.com/acme/legacy',
            default_branch: 'master',
            language: 'Perl',
            topics: ['legacy'],
            archived: true,
        });

        expect(repo).toMatchObject({
            name: 'acme/legacy',
            orgKey: 'acme',
            defaultBranch: 'master',
            primaryLanguage: 'Perl',
            archived: true,
            enabled: false,
        });
    });
});

describe('parseGitHubUrl', () => {
    test.each([
        ['https://github.com/acme/api', { owner: 'acme', repo: 'api' }],
        ['git@github.com:acme/api.git', { owner: 'acme', repo: 'api' }],
        ['https://example.com/acme/api', { owner: '', repo: '' }],
    ])('%s', (url, expected) => {
        expect(parseGitHubUrl(url)).toEqual(expected);
    });
});
