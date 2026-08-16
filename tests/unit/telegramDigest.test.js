/**
 * The digest message. No network, no database — just what it says and how long
 * it is, which is where a chat message goes wrong.
 */
import { test, expect, describe } from '@jest/globals';
import { buildDigestMessage } from '#app/infrastructure/notifiers/telegramDigest.js';

const EMPTY = {
    windowDays: 7,
    totalCount: 0,
    openTotal: 0,
    affecting: { count: 0, openCount: 0, repositories: [] },
    infrastructure: { count: 0 },
    dependencies: { count: 0, repositories: [] },
};

describe('the weekly digest', () => {
    test('a week with nothing at all produces no message', () => {
        expect(buildDigestMessage(EMPTY)).toBeNull();
        expect(buildDigestMessage(null)).toBeNull();
    });

    test('a quiet week with a backlog still reports the backlog', () => {
        const message = buildDigestMessage({ ...EMPTY, openTotal: 113 });

        expect(message.text).toContain('0 new findings');
        expect(message.text).toContain('113 still open');
    });

    test('names the repositories reached and their worst CVEs', () => {
        const message = buildDigestMessage({
            ...EMPTY,
            totalCount: 2,
            openTotal: 5,
            affecting: {
                count: 2,
                openCount: 4,
                repositories: [
                    {
                        name: 'acme/api',
                        url: 'https://github.com/acme/api',
                        vulnerabilities: [{ cveId: 'CVE-2024-0001', severity: 'CRITICAL' }],
                    },
                ],
            },
        });

        expect(message.text).toContain('acme/api');
        expect(message.text).toContain('CVE-2024-0001 (CRITICAL)');
    });

    test('lists what fell behind, per repository, with the version gap', () => {
        const message = buildDigestMessage({
            ...EMPTY,
            dependencies: {
                count: 1,
                repositories: [
                    {
                        name: 'acme/web',
                        dependencies: [
                            {
                                name: 'express',
                                declared: '4.18.0',
                                latest: '4.19.2',
                                gap: '2 minor',
                            },
                        ],
                    },
                ],
            },
        });

        expect(message.text).toContain('Dependencies behind:</b> 1');
        expect(message.text).toContain('express 4.18.0 → 4.19.2');
        expect(message.text).toContain('2 minor');
    });

    test('caps the lists but keeps the totals honest', () => {
        const repositories = Array.from({ length: 12 }, (_, index) => ({
            name: `acme/repo-${index}`,
            dependencies: Array.from({ length: 9 }, (_, n) => ({
                name: `pkg-${n}`,
                declared: '1.0.0',
                latest: '2.0.0',
                gap: '1 major',
            })),
        }));

        const message = buildDigestMessage({
            ...EMPTY,
            dependencies: { count: 108, repositories },
        });

        expect(message.text).toContain('108');
        expect(message.text).toContain('and 7 more repositories');
        expect(message.text).toContain('and 4 more');
        expect(message.text.length).toBeLessThanOrEqual(4096);
    });

    test('escapes a repository name that would break the markup', () => {
        const message = buildDigestMessage({
            ...EMPTY,
            dependencies: {
                count: 1,
                repositories: [
                    {
                        name: 'acme/<b>evil</b>',
                        dependencies: [{ name: 'x&y', declared: '1', latest: '2' }],
                    },
                ],
            },
        });

        expect(message.text).toContain('&lt;b&gt;evil&lt;/b&gt;');
        expect(message.text).toContain('x&amp;y');
    });

    test('a scoped digest says whose it is', () => {
        const message = buildDigestMessage({ ...EMPTY, openTotal: 1 }, { scopeLabel: 'your repositories' });
        expect(message.text).toContain('your repositories');
    });
});
