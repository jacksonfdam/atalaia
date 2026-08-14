/**
 * Integration tests for the email delivery settings.
 *
 * Nothing here opens an SMTP connection: the tests cover the catalog, storage
 * and the rules around the credential. The transport itself is exercised by the
 * console's "Test connection" button, which needs a real provider.
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

const { schema } = useSchema('email_settings');
process.env.API_KEY = 'test-api-key';
process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key';

const cache = await import('#app/infrastructure/cache/postgresCache.js');
const { initializeDatabase } = cache;
const { createApp } = await import('#app/interface/http/createApp.js');
const { query, queryOne } = await import('#app/infrastructure/db/pool.js');

// Cleared *after* the imports: config.js calls dotenv.config(), which would
// otherwise repopulate these from the developer's .env and make every
// configuration look env-pinned.
const ENV_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'EMAIL_RECIPIENTS', 'EMAIL_TEMPLATE'];
for (const key of ENV_KEYS) delete process.env[key];

const KEY = { 'X-API-Key': 'test-api-key' };
let app;

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
    await truncateAll(); // was: DELETE FROM email_config;
    for (const key of ENV_KEYS) delete process.env[key];
});

const RESEND = {
    provider: 'resend',
    secret: 're_live_ABCD1234',
    from: 'atalaia@example.com',
    recipients: 'security@example.com, cto@example.com',
    template: 'minimal',
    enabled: true,
};

describe('GET /api/v1/settings/email', () => {
    test('lists every provider with the fields its form needs', async () => {
        const res = await request(app).get('/api/v1/settings/email').set(KEY);

        expect(res.status).toBe(200);
        expect(res.body.providers.map(p => p.id)).toEqual([
            'mailtrap',
            'mailjet',
            'sendgrid',
            'mailgun',
            'mailerlite',
            'resend',
            'smtp',
        ]);

        const sendgrid = res.body.providers.find(p => p.id === 'sendgrid');
        expect(sendgrid.defaults).toEqual({ host: 'smtp.sendgrid.net', port: 587, username: 'apikey' });
        expect(sendgrid.fields).toEqual([
            expect.objectContaining({ name: 'secret', secret: true, required: true }),
        ]);
    });

    test('reports that nothing is configured yet', async () => {
        const res = await request(app).get('/api/v1/settings/email').set(KEY);

        expect(res.body.status).toMatchObject({ ready: false, source: 'none' });
        expect(res.body.envLocked).toBe(false);
    });
});

describe('PUT /api/v1/settings/email', () => {
    test('stores the configuration and fills in the provider defaults', async () => {
        const res = await request(app).put('/api/v1/settings/email').set(KEY).send(RESEND);

        expect(res.status).toBe(200);
        expect(res.body.config).toMatchObject({
            provider: 'resend',
            host: 'smtp.resend.com',
            port: 587,
            username: 'resend',
            hasSecret: true,
            secretHint: '••••1234',
            template: 'minimal',
            enabled: true,
        });
        expect(res.body.status).toMatchObject({ ready: true, source: 'database', recipients: 2 });
    });

    test('never returns the credential, and never stores it in the clear', async () => {
        await request(app).put('/api/v1/settings/email').set(KEY).send(RESEND);

        const res = await request(app).get('/api/v1/settings/email').set(KEY);
        expect(JSON.stringify(res.body)).not.toContain('re_live_ABCD1234');

        const row = await queryOne('SELECT secret_cipher FROM email_config');
        expect(row.secret_cipher).not.toContain('re_live');
    });

    test('keeps the stored credential when the payload omits it', async () => {
        await request(app).put('/api/v1/settings/email').set(KEY).send(RESEND);
        const res = await request(app)
            .put('/api/v1/settings/email')
            .set(KEY)
            .send({ ...RESEND, secret: undefined, recipients: 'only@example.com' });

        expect(res.body.config.hasSecret).toBe(true);
        expect(res.body.config.secretHint).toBe('••••1234');
    });

    test('clears the credential when given an empty string', async () => {
        await request(app).put('/api/v1/settings/email').set(KEY).send(RESEND);
        const res = await request(app).put('/api/v1/settings/email').set(KEY).send({ ...RESEND, secret: '' });

        expect(res.body.config.hasSecret).toBe(false);
    });

    test('drops the credential when the provider changes', async () => {
        await request(app).put('/api/v1/settings/email').set(KEY).send(RESEND);

        // A SendGrid key is not a Mailgun password — carrying it over would
        // authenticate against the wrong service with a stale secret.
        const res = await request(app)
            .put('/api/v1/settings/email')
            .set(KEY)
            .send({ provider: 'mailgun', username: 'postmaster@mg.example.com' });

        expect(res.body.config.provider).toBe('mailgun');
        expect(res.body.config.hasSecret).toBe(false);
    });

    test('rejects an unknown provider and a bogus template', async () => {
        expect((await request(app).put('/api/v1/settings/email').set(KEY).send({ provider: 'pigeon' })).status).toBe(400);
        expect(
            (await request(app).put('/api/v1/settings/email').set(KEY).send({ provider: 'smtp', template: 'fancy' }))
                .status
        ).toBe(400);
    });

    test('requires a provider', async () => {
        const res = await request(app).put('/api/v1/settings/email').set(KEY).send({ from: 'a@b.com' });
        expect(res.status).toBe(400);
    });

    test('is not ready while delivery is switched off', async () => {
        const res = await request(app).put('/api/v1/settings/email').set(KEY).send({ ...RESEND, enabled: false });

        expect(res.body.status.ready).toBe(false);
        expect(res.body.status.reason).toContain('switched off');
    });
});

describe('environment pinning', () => {
    test('refuses to write while SMTP_HOST is set', async () => {
        process.env.SMTP_HOST = 'smtp.env.example.com';

        const res = await request(app).put('/api/v1/settings/email').set(KEY).send(RESEND);

        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/SMTP_HOST/);
    });

    test('reports the environment as the source', async () => {
        process.env.SMTP_HOST = 'smtp.env.example.com';
        process.env.EMAIL_RECIPIENTS = 'ops@example.com';

        const res = await request(app).get('/api/v1/settings/email').set(KEY);

        expect(res.body.envLocked).toBe(true);
        expect(res.body.status).toMatchObject({ ready: true, source: 'env', recipients: 1 });
    });
});
