/**
 * Passkey sign-in, end to end over HTTP.
 *
 * A software authenticator signs real assertions against the real verifier, so
 * what is exercised is the ceremony rather than a stub of it: the challenge is
 * issued, spent and refused a second time; the signature is checked; the
 * counter rule is applied.
 */
import { test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import {
    describeWithDatabase as describe,
    hasDatabase,
    useSchema,
    setUpSchema,
    tearDownSchema,
    truncateAll,
} from '../../helpers/postgres.js';
import { createAuthenticator } from '../../helpers/authenticator.js';

const { schema } = useSchema('auth_routes');

process.env.API_KEY = 'test-api-key';
process.env.SETUP_PASSWORD = 'the-setup-password';
process.env.WEBAUTHN_RP_ID = 'localhost';
process.env.WEBAUTHN_ORIGINS = 'http://localhost:3001';
delete process.env.AUTH_ALLOW_BREAKGLASS;

const { initializeDatabase } = await import('#app/infrastructure/cache/postgresCache.js');
const cache = await import('#app/infrastructure/cache/postgresCache.js');
const { createApp } = await import('#app/interface/http/createApp.js');
const { query, queryAll, queryOne } = await import('#app/infrastructure/db/pool.js');
const { resetRateLimits } = await import('#app/middleware/rateLimit.js');

const KEY = { 'X-API-Key': 'test-api-key' };
const RP = { rpId: 'localhost', origin: 'http://localhost:3001' };

let app;

/** Sign in as a brand new administrator, and hand back its session token. */
async function bootstrapAdmin(authenticator, username = 'jackson') {
    const options = await request(app)
        .post('/api/v1/auth/registration/options')
        .set(KEY)
        .send({ username, displayName: 'Jackson', setupPassword: 'the-setup-password' })
        .expect(200);

    const response = authenticator.register({ ...RP, challenge: options.body.challenge });

    const verified = await request(app)
        .post('/api/v1/auth/registration/verify')
        .set(KEY)
        .send({ response })
        .expect(200);

    return verified.body;
}

/** A full sign-in with an authenticator that is already enrolled. */
async function signIn(authenticator, counter) {
    const options = await request(app)
        .post('/api/v1/auth/authentication/options')
        .set(KEY)
        .send({})
        .expect(200);

    const response = authenticator.authenticate({
        ...RP,
        challenge: options.body.challenge,
        counter,
    });

    return await request(app).post('/api/v1/auth/authentication/verify').set(KEY).send({ response });
}

async function enroll(token, authenticator) {
    const options = await request(app)
        .post('/api/v1/auth/credentials')
        .set(KEY)
        .set('X-Session-Token', token)
        .send({ nickname: 'Backup key' })
        .expect(200);

    const response = authenticator.register({ ...RP, challenge: options.body.challenge });

    return await request(app)
        .post('/api/v1/auth/registration/verify')
        .set(KEY)
        .set('X-Session-Token', token)
        .send({ response, nickname: 'Backup key' })
        .expect(200);
}

async function auditEvents() {
    const rows = await queryAll('SELECT event FROM auth_audit_log ORDER BY id');
    return rows.map(row => row.event);
}

beforeAll(async () => {
    if (!hasDatabase) return;
    await setUpSchema(schema);
    await initializeDatabase();
    app = createApp(cache);
});

afterAll(async () => {
    if (!hasDatabase) return;
    await tearDownSchema(schema);
});

beforeEach(async () => {
    if (!hasDatabase) return;
    await truncateAll();
    // The limiter keeps its buckets in memory, so without this the suite would
    // lock itself out somewhere around the fifth bootstrap.
    resetRateLimits();
});

describe('before the first account exists', () => {
    test('the console is told it needs bootstrapping', async () => {
        const { body } = await request(app).get('/api/v1/auth/state').set(KEY).expect(200);

        expect(body.bootstrapped).toBe(false);
        expect(body.setupPasswordConfigured).toBe(true);
    });

    test('registration needs the setup password', async () => {
        await request(app)
            .post('/api/v1/auth/registration/options')
            .set(KEY)
            .send({ username: 'jackson', displayName: 'Jackson' })
            .expect(401);
    });

    test('the wrong setup password says only that it failed', async () => {
        const { body } = await request(app)
            .post('/api/v1/auth/registration/options')
            .set(KEY)
            .send({ username: 'jackson', setupPassword: 'wrong' })
            .expect(401);

        expect(body).toEqual({ error: 'Authentication failed' });
    });
});

describe('what is rate limited', () => {
    test('guessing the setup password, aggressively', async () => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            await request(app)
                .post('/api/v1/auth/registration/options')
                .set(KEY)
                .send({ username: 'jackson', setupPassword: `wrong-${attempt}` })
                .expect(401);
        }

        const { body, status } = await request(app)
            .post('/api/v1/auth/registration/options')
            .set(KEY)
            .send({ username: 'jackson', setupPassword: 'the-setup-password' });

        expect(status).toBe(429);
        expect(body.retryAfterSeconds).toBeGreaterThan(0);
    });

    test('guessing a recovery code, per account named', async () => {
        await bootstrapAdmin(createAuthenticator());

        for (let attempt = 0; attempt < 5; attempt += 1) {
            await request(app)
                .post('/api/v1/auth/recovery/verify')
                .set(KEY)
                .send({ username: 'jackson', code: `WRONG0-WRONG0-WRONG0-WRONG${attempt}` })
                .expect(401);
        }

        const { status } = await request(app)
            .post('/api/v1/auth/recovery/verify')
            .set(KEY)
            .send({ username: 'jackson', code: 'WRONG0-WRONG0-WRONG0-WRONG9' });

        expect(status).toBe(429);
    });
});

describe('bootstrap', () => {
    test('creates an administrator, ten recovery codes and a session', async () => {
        const result = await bootstrapAdmin(createAuthenticator());

        expect(result.user.isAdmin).toBe(true);
        expect(result.recoveryCodes).toHaveLength(10);
        expect(result.token).toEqual(expect.any(String));

        const { body } = await request(app).get('/api/v1/auth/state').set(KEY).expect(200);
        expect(body.bootstrapped).toBe(true);
    });

    test('closes registration behind it', async () => {
        await bootstrapAdmin(createAuthenticator());

        const { body } = await request(app)
            .post('/api/v1/auth/registration/options')
            .set(KEY)
            .send({ username: 'someone', setupPassword: 'the-setup-password' })
            .expect(403);

        expect(body.error).toMatch(/closed/i);
    });

    test('the setup password no longer signs anybody in', async () => {
        await bootstrapAdmin(createAuthenticator());

        await request(app)
            .post('/api/v1/auth/registration/options')
            .set(KEY)
            .send({ username: 'jackson', setupPassword: 'the-setup-password' })
            .expect(403);
    });
});

describe('signing in', () => {
    test('works with no username typed', async () => {
        const authenticator = createAuthenticator();
        await bootstrapAdmin(authenticator);

        const { body, status } = await signIn(authenticator);

        expect(status).toBe(200);
        expect(body.user.username).toBe('jackson');
        expect(body.token).toEqual(expect.any(String));
    });

    test('refuses a replayed assertion', async () => {
        const authenticator = createAuthenticator();
        await bootstrapAdmin(authenticator);

        const options = await request(app)
            .post('/api/v1/auth/authentication/options')
            .set(KEY)
            .send({})
            .expect(200);

        const response = authenticator.authenticate({ ...RP, challenge: options.body.challenge });

        await request(app).post('/api/v1/auth/authentication/verify').set(KEY).send({ response }).expect(200);

        const replayed = await request(app)
            .post('/api/v1/auth/authentication/verify')
            .set(KEY)
            .send({ response });

        expect(replayed.status).toBe(401);
        expect(replayed.body).toEqual({ error: 'Authentication failed' });
    });

    test('refuses an expired challenge', async () => {
        const authenticator = createAuthenticator();
        await bootstrapAdmin(authenticator);

        const options = await request(app)
            .post('/api/v1/auth/authentication/options')
            .set(KEY)
            .send({})
            .expect(200);

        await query(
            `UPDATE webauthn_challenges SET expires_at = now() - interval '1 second'
              WHERE consumed_at IS NULL`
        );

        const response = authenticator.authenticate({ ...RP, challenge: options.body.challenge });

        await request(app)
            .post('/api/v1/auth/authentication/verify')
            .set(KEY)
            .send({ response })
            .expect(401);
    });

    test('refuses a credential nobody registered, and says no more than that', async () => {
        await bootstrapAdmin(createAuthenticator());

        const stranger = createAuthenticator();
        const { body, status } = await signIn(stranger);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication failed' });
    });

    test('accepts a synced passkey reporting zero forever', async () => {
        const authenticator = createAuthenticator({ syncedPasskey: true });
        await bootstrapAdmin(authenticator);

        expect((await signIn(authenticator)).status).toBe(200);
        expect((await signIn(authenticator)).status).toBe(200);
    });

    test('rejects a counter that has gone backwards, and records it', async () => {
        const authenticator = createAuthenticator({ syncedPasskey: false });
        await bootstrapAdmin(authenticator);

        expect((await signIn(authenticator, 7)).status).toBe(200);

        const cloned = await signIn(authenticator, 5);
        expect(cloned.status).toBe(401);
        expect(await auditEvents()).toContain('auth.counter_regressed');

        const row = await queryOne(
            "SELECT metadata FROM auth_audit_log WHERE event = 'auth.counter_regressed'"
        );
        expect(row.metadata).toMatchObject({ stored: 7, reported: 5 });
    });
});

describe('a session', () => {
    test('answers /me with the account and its passkey count', async () => {
        const authenticator = createAuthenticator();
        const { token } = await bootstrapAdmin(authenticator);

        const { body } = await request(app)
            .get('/api/v1/auth/me')
            .set(KEY)
            .set('X-Session-Token', token)
            .expect(200);

        expect(body.user.username).toBe('jackson');
        expect(body.credentialCount).toBe(1);
        expect(body.recoveryCodesRemaining).toBe(10);
        expect(body.scope).toBe('full');
    });

    test('stops working once it is signed out', async () => {
        const { token } = await bootstrapAdmin(createAuthenticator());

        await request(app).post('/api/v1/auth/logout').set(KEY).set('X-Session-Token', token).expect(200);

        await request(app).get('/api/v1/auth/me').set(KEY).set('X-Session-Token', token).expect(401);
    });

    test('gates the rest of the API when it is stale, without blocking the CLI', async () => {
        const { token } = await bootstrapAdmin(createAuthenticator());
        await request(app).post('/api/v1/auth/logout').set(KEY).set('X-Session-Token', token);

        // A dead session is a rejection...
        const rejected = await request(app).get('/api/v1/stats').set(KEY).set('X-Session-Token', token);
        expect(rejected.status).toBe(401);
        expect(rejected.body.code).toBe('session_required');

        // ...while a machine client presenting only the API key is unaffected.
        await request(app).get('/api/v1/stats').set(KEY).expect(200);
    });
});

describe('managing passkeys', () => {
    test('the last one cannot be deleted', async () => {
        const authenticator = createAuthenticator();
        const { token } = await bootstrapAdmin(authenticator);

        const { body } = await request(app)
            .get('/api/v1/auth/credentials')
            .set(KEY)
            .set('X-Session-Token', token)
            .expect(200);

        const refused = await request(app)
            .delete(`/api/v1/auth/credentials/${body.credentials[0].id}`)
            .set(KEY)
            .set('X-Session-Token', token)
            .expect(409);

        expect(refused.body.error).toMatch(/only passkey/i);
    });

    test('a second one can be enrolled, and then the first removed', async () => {
        const first = createAuthenticator();
        const { token } = await bootstrapAdmin(first);

        await enroll(token, createAuthenticator());

        const { body } = await request(app)
            .get('/api/v1/auth/credentials')
            .set(KEY)
            .set('X-Session-Token', token)
            .expect(200);

        expect(body.credentials).toHaveLength(2);

        await request(app)
            .delete(`/api/v1/auth/credentials/${body.credentials[0].id}`)
            .set(KEY)
            .set('X-Session-Token', token)
            .expect(200);

        expect(await auditEvents()).toContain('credential.deleted');
    });

    test('one account cannot delete another account\'s passkey', async () => {
        const admin = createAuthenticator();
        const { token: adminToken } = await bootstrapAdmin(admin);

        const invite = await request(app)
            .post('/api/v1/auth/invites')
            .set(KEY)
            .set('X-Session-Token', adminToken)
            .send({ username: 'colleague', displayName: 'A Colleague' })
            .expect(201);

        const other = createAuthenticator();
        const options = await request(app)
            .post('/api/v1/auth/registration/options')
            .set(KEY)
            .send({ inviteToken: invite.body.token })
            .expect(200);

        const registered = await request(app)
            .post('/api/v1/auth/registration/verify')
            .set(KEY)
            .send({ response: other.register({ ...RP, challenge: options.body.challenge }) })
            .expect(200);

        const mine = await request(app)
            .get('/api/v1/auth/credentials')
            .set(KEY)
            .set('X-Session-Token', adminToken)
            .expect(200);

        // Their session, my credential id: no such passkey.
        await request(app)
            .delete(`/api/v1/auth/credentials/${mine.body.credentials[0].id}`)
            .set(KEY)
            .set('X-Session-Token', registered.body.token)
            .expect(409);
    });
});

describe('invitations', () => {
    test('are how an account comes to exist after the first', async () => {
        const { token } = await bootstrapAdmin(createAuthenticator());

        const invite = await request(app)
            .post('/api/v1/auth/invites')
            .set(KEY)
            .set('X-Session-Token', token)
            .send({ username: 'colleague', displayName: 'A Colleague' })
            .expect(201);

        expect(invite.body.token).toEqual(expect.any(String));

        const options = await request(app)
            .post('/api/v1/auth/registration/options')
            .set(KEY)
            .send({ inviteToken: invite.body.token })
            .expect(200);

        const registered = await request(app)
            .post('/api/v1/auth/registration/verify')
            .set(KEY)
            .send({ response: createAuthenticator().register({ ...RP, challenge: options.body.challenge }) })
            .expect(200);

        expect(registered.body.user.username).toBe('colleague');
        expect(registered.body.user.isAdmin).toBe(false);
        expect(registered.body.recoveryCodes).toHaveLength(10);
    });

    test('work exactly once', async () => {
        const { token } = await bootstrapAdmin(createAuthenticator());

        const invite = await request(app)
            .post('/api/v1/auth/invites')
            .set(KEY)
            .set('X-Session-Token', token)
            .send({ username: 'colleague' })
            .expect(201);

        await request(app)
            .post('/api/v1/auth/registration/options')
            .set(KEY)
            .send({ inviteToken: invite.body.token })
            .expect(200);

        await request(app)
            .post('/api/v1/auth/registration/options')
            .set(KEY)
            .send({ inviteToken: invite.body.token })
            .expect(401);
    });

    test('are an administrator\'s to issue', async () => {
        const { token } = await bootstrapAdmin(createAuthenticator());

        const invite = await request(app)
            .post('/api/v1/auth/invites')
            .set(KEY)
            .set('X-Session-Token', token)
            .send({ username: 'colleague' })
            .expect(201);

        const options = await request(app)
            .post('/api/v1/auth/registration/options')
            .set(KEY)
            .send({ inviteToken: invite.body.token })
            .expect(200);

        const registered = await request(app)
            .post('/api/v1/auth/registration/verify')
            .set(KEY)
            .send({ response: createAuthenticator().register({ ...RP, challenge: options.body.challenge }) })
            .expect(200);

        await request(app)
            .post('/api/v1/auth/invites')
            .set(KEY)
            .set('X-Session-Token', registered.body.token)
            .send({ username: 'yet-another' })
            .expect(403);
    });
});

describe('recovery', () => {
    test('a code buys one chance to enroll a passkey, and nothing else', async () => {
        const { recoveryCodes } = await bootstrapAdmin(createAuthenticator());

        const recovered = await request(app)
            .post('/api/v1/auth/recovery/verify')
            .set(KEY)
            .send({ username: 'jackson', code: recoveryCodes[0] })
            .expect(200);

        expect(recovered.body.scope).toBe('recovery');
        expect(recovered.body.remaining).toBe(9);

        // Not a working session for the console.
        await request(app)
            .get('/api/v1/stats')
            .set(KEY)
            .set('X-Session-Token', recovered.body.token)
            .expect(403);

        // But it does enroll a passkey, and that comes back as a full session.
        const enrolled = await enroll(recovered.body.token, createAuthenticator());
        expect(enrolled.body.token).not.toBe(recovered.body.token);

        await request(app)
            .get('/api/v1/stats')
            .set(KEY)
            .set('X-Session-Token', enrolled.body.token)
            .expect(200);
    });

    test('a code works once', async () => {
        const { recoveryCodes } = await bootstrapAdmin(createAuthenticator());

        await request(app)
            .post('/api/v1/auth/recovery/verify')
            .set(KEY)
            .send({ username: 'jackson', code: recoveryCodes[0] })
            .expect(200);

        await request(app)
            .post('/api/v1/auth/recovery/verify')
            .set(KEY)
            .send({ username: 'jackson', code: recoveryCodes[0] })
            .expect(401);
    });

    test('is forgiving about how the code was written down', async () => {
        const { recoveryCodes } = await bootstrapAdmin(createAuthenticator());
        const messy = recoveryCodes[0].toLowerCase().replace(/-/g, ' ');

        await request(app)
            .post('/api/v1/auth/recovery/verify')
            .set(KEY)
            .send({ username: 'jackson', code: messy })
            .expect(200);
    });

    test('says the same thing to an unknown account as to a wrong code', async () => {
        await bootstrapAdmin(createAuthenticator());

        const unknown = await request(app)
            .post('/api/v1/auth/recovery/verify')
            .set(KEY)
            .send({ username: 'nobody', code: 'ABCDEF-GHJKMN-PQRSTV-WXYZ01' });

        const wrong = await request(app)
            .post('/api/v1/auth/recovery/verify')
            .set(KEY)
            .send({ username: 'jackson', code: 'ABCDEF-GHJKMN-PQRSTV-WXYZ01' });

        expect(unknown.status).toBe(401);
        expect(unknown.body).toEqual(wrong.body);
    });

    test('reissuing replaces every code that was outstanding', async () => {
        const { token, recoveryCodes } = await bootstrapAdmin(createAuthenticator());

        const reissued = await request(app)
            .post('/api/v1/auth/recovery/codes')
            .set(KEY)
            .set('X-Session-Token', token)
            .expect(200);

        expect(reissued.body.codes).toHaveLength(10);

        await request(app)
            .post('/api/v1/auth/recovery/verify')
            .set(KEY)
            .send({ username: 'jackson', code: recoveryCodes[0] })
            .expect(401);
    });
});

describe('an administrator resetting an account', () => {
    test('removes every passkey, ends the sessions and reissues codes', async () => {
        const admin = createAuthenticator();
        const { token: adminToken } = await bootstrapAdmin(admin);

        const invite = await request(app)
            .post('/api/v1/auth/invites')
            .set(KEY)
            .set('X-Session-Token', adminToken)
            .send({ username: 'colleague' })
            .expect(201);

        const options = await request(app)
            .post('/api/v1/auth/registration/options')
            .set(KEY)
            .send({ inviteToken: invite.body.token })
            .expect(200);

        const registered = await request(app)
            .post('/api/v1/auth/registration/verify')
            .set(KEY)
            .send({ response: createAuthenticator().register({ ...RP, challenge: options.body.challenge }) })
            .expect(200);

        const reset = await request(app)
            .post(`/api/v1/auth/users/${registered.body.user.id}/reset`)
            .set(KEY)
            .set('X-Session-Token', adminToken)
            .expect(200);

        expect(reset.body.removed).toBe(1);
        expect(reset.body.codes).toHaveLength(10);

        await request(app)
            .get('/api/v1/auth/me')
            .set(KEY)
            .set('X-Session-Token', registered.body.token)
            .expect(401);
    });
});
