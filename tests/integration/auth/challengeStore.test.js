/**
 * A challenge is good exactly once.
 *
 * Everything else about WebAuthn can be right and the login still be replayable
 * if this is wrong, so the cases are the ways a challenge can come back at us:
 * twice, late, for the wrong ceremony, or never issued at all.
 */
import { test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import {
    describeWithDatabase as describe,
    hasDatabase,
    useSchema,
    setUpSchema,
    tearDownSchema,
    truncateAll,
} from '../../helpers/postgres.js';

const { schema } = useSchema('challenge_store');

const { issueChallenge, consumeChallenge, sweepChallenges } = await import(
    '#app/infrastructure/auth/challengeStore.js'
);
const { query, queryOne } = await import('#app/infrastructure/db/pool.js');

/** base64url, as SimpleWebAuthn hands them out. */
function randomChallenge(seed) {
    return Buffer.from(`challenge-${seed}`.padEnd(32, '.')).toString('base64url');
}

beforeAll(async () => {
    if (!hasDatabase) return;
    await setUpSchema(schema);
});

afterAll(async () => {
    if (!hasDatabase) return;
    await tearDownSchema(schema);
});

beforeEach(async () => {
    if (!hasDatabase) return;
    await truncateAll();
});

describe('consuming a challenge', () => {
    test('succeeds once and never again', async () => {
        const challenge = randomChallenge('once');
        await issueChallenge({ challenge, ceremony: 'authentication' });

        expect(await consumeChallenge({ challenge, ceremony: 'authentication' })).not.toBeNull();
        expect(await consumeChallenge({ challenge, ceremony: 'authentication' })).toBeNull();
    });

    test('fails for a challenge that was never issued', async () => {
        expect(
            await consumeChallenge({ challenge: randomChallenge('ghost'), ceremony: 'authentication' })
        ).toBeNull();
    });

    test('fails once expired', async () => {
        const challenge = randomChallenge('stale');
        await issueChallenge({ challenge, ceremony: 'registration' });

        await query(
            `UPDATE webauthn_challenges SET expires_at = now() - interval '1 second'
             WHERE challenge = @challenge`,
            { challenge: Buffer.from(challenge, 'base64url') }
        );

        expect(await consumeChallenge({ challenge, ceremony: 'registration' })).toBeNull();
    });

    test('does not cross from one ceremony to the other', async () => {
        const challenge = randomChallenge('crossed');
        await issueChallenge({ challenge, ceremony: 'registration' });

        expect(await consumeChallenge({ challenge, ceremony: 'authentication' })).toBeNull();
        expect(await consumeChallenge({ challenge, ceremony: 'registration' })).not.toBeNull();
    });

    test('rejects a missing or empty value without touching the database', async () => {
        expect(await consumeChallenge({ challenge: undefined, ceremony: 'authentication' })).toBeNull();
        expect(await consumeChallenge({ challenge: '', ceremony: 'authentication' })).toBeNull();
    });

    test('lets exactly one of two racing callers through', async () => {
        const challenge = randomChallenge('race');
        await issueChallenge({ challenge, ceremony: 'authentication' });

        const results = await Promise.all([
            consumeChallenge({ challenge, ceremony: 'authentication' }),
            consumeChallenge({ challenge, ceremony: 'authentication' }),
            consumeChallenge({ challenge, ceremony: 'authentication' }),
        ]);

        expect(results.filter(Boolean)).toHaveLength(1);
    });
});

describe('the sweep', () => {
    test('removes what expired and leaves what has not', async () => {
        const stale = randomChallenge('gone');
        const live = randomChallenge('kept');

        await issueChallenge({ challenge: stale, ceremony: 'authentication' });
        await issueChallenge({ challenge: live, ceremony: 'authentication' });

        await query(
            `UPDATE webauthn_challenges SET expires_at = now() - interval '1 hour'
             WHERE challenge = @challenge`,
            { challenge: Buffer.from(stale, 'base64url') }
        );

        expect(await sweepChallenges()).toBe(1);

        const remaining = await queryOne('SELECT count(*)::int AS n FROM webauthn_challenges');
        expect(remaining.n).toBe(1);
    });
});
