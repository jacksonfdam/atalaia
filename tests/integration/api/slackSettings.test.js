/**
 * Integration tests for Slack delivery settings.
 *
 * No message leaves the process: the tests cover storage, validation and the
 * rules around the credential. Actually posting is what the console's "Send
 * test" button is for.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atalaia-slack-')), 'test.db');

process.env.DB_PATH = TMP_DB;
process.env.API_KEY = 'test-api-key';
process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key';

const cache = await import('#app/infrastructure/cache/sqliteCache.js');
const { initializeDatabase, getDb } = cache;
const { createApp } = await import('#app/interface/http/createApp.js');

// Cleared *after* the imports: config.js calls dotenv.config(), which would
// otherwise repopulate them from the developer's .env.
const ENV_KEYS = ['SLACK_WEBHOOK_URL', 'SLACK_ENABLED'];
for (const key of ENV_KEYS) delete process.env[key];

const KEY = { 'X-API-Key': 'test-api-key' };
let app;

const BOT = {
    mode: 'bot',
    botToken: 'xoxb-0000-AAAA-secret9999',
    destination: '#security',
    notifyOwners: true,
    enabled: true,
};

beforeAll(() => {
    initializeDatabase();
    app = createApp(cache);
});

afterAll(() => {
    fs.rmSync(path.dirname(TMP_DB), { recursive: true, force: true });
});

beforeEach(() => {
    getDb().exec('DELETE FROM slack_config;');
    for (const key of ENV_KEYS) delete process.env[key];
});

describe('PUT /api/v1/settings/slack', () => {
    test('stores a bot integration and reports it as ready', async () => {
        const res = await request(app).put('/api/v1/settings/slack').set(KEY).send(BOT);

        expect(res.status).toBe(200);
        expect(res.body.config).toMatchObject({
            mode: 'bot',
            hasBotToken: true,
            botHint: '••••9999',
            destination: '#security',
            destinationKind: 'channel',
            notifyOwners: true,
            enabled: true,
        });
        expect(res.body.status).toMatchObject({ ready: true, source: 'database', mode: 'bot' });
    });

    test('never returns the credential, and never stores it in the clear', async () => {
        await request(app).put('/api/v1/settings/slack').set(KEY).send(BOT);

        const res = await request(app).get('/api/v1/settings/slack').set(KEY);
        expect(JSON.stringify(res.body)).not.toContain('secret9999');

        const row = getDb().prepare('SELECT bot_cipher FROM slack_config').get();
        expect(row.bot_cipher).not.toContain('xoxb-0000');
    });

    test('keeps the stored token when the payload omits it', async () => {
        await request(app).put('/api/v1/settings/slack').set(KEY).send(BOT);
        const res = await request(app)
            .put('/api/v1/settings/slack')
            .set(KEY)
            .send({ mode: 'bot', destination: '#ops', enabled: true });

        expect(res.body.config.hasBotToken).toBe(true);
        expect(res.body.config.destination).toBe('#ops');
    });

    test('recognises a member ID as a direct message', async () => {
        const res = await request(app)
            .put('/api/v1/settings/slack')
            .set(KEY)
            .send({ ...BOT, destination: 'U01ABCDEF' });

        expect(res.body.config.destinationKind).toBe('user');
    });

    test('prefixes a bare channel name', async () => {
        const res = await request(app)
            .put('/api/v1/settings/slack')
            .set(KEY)
            .send({ ...BOT, destination: 'security' });

        expect(res.body.config.destination).toBe('#security');
    });

    test('rejects a credential that is not Slack shaped', async () => {
        expect(
            (await request(app).put('/api/v1/settings/slack').set(KEY).send({ mode: 'bot', botToken: 'nope' }))
                .status
        ).toBe(400);

        expect(
            (
                await request(app)
                    .put('/api/v1/settings/slack')
                    .set(KEY)
                    .send({ mode: 'webhook', webhookUrl: 'https://evil.example.com/hook' })
            ).status
        ).toBe(400);

        expect((await request(app).put('/api/v1/settings/slack').set(KEY).send({ mode: 'carrier-pigeon' })).status).toBe(
            400
        );
    });

    test('is not ready without a destination in bot mode', async () => {
        const res = await request(app)
            .put('/api/v1/settings/slack')
            .set(KEY)
            .send({ mode: 'bot', botToken: 'xoxb-1', enabled: true, destination: '' });

        expect(res.body.status.ready).toBe(false);
        expect(res.body.status.reason).toContain('no channel or user');
    });

    test('is not ready while switched off', async () => {
        const res = await request(app).put('/api/v1/settings/slack').set(KEY).send({ ...BOT, enabled: false });

        expect(res.body.status.ready).toBe(false);
        expect(res.body.status.reason).toContain('switched off');
    });
});

describe('environment pinning', () => {
    test('refuses to write while SLACK_WEBHOOK_URL is set', async () => {
        process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/env';

        const res = await request(app).put('/api/v1/settings/slack').set(KEY).send(BOT);

        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/SLACK_WEBHOOK_URL/);
    });

    test('a webhook in the environment counts as on unless SLACK_ENABLED says otherwise', async () => {
        process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/env';

        let res = await request(app).get('/api/v1/settings/slack').set(KEY);
        expect(res.body.status).toMatchObject({ ready: true, source: 'env' });

        process.env.SLACK_ENABLED = 'false';
        res = await request(app).get('/api/v1/settings/slack').set(KEY);
        expect(res.body.status.ready).toBe(false);
    });

    test('SLACK_ENABLED=false overrides a stored integration', async () => {
        await request(app).put('/api/v1/settings/slack').set(KEY).send(BOT);
        process.env.SLACK_ENABLED = 'false';

        const res = await request(app).get('/api/v1/settings/slack').set(KEY);
        expect(res.body.status.ready).toBe(false);
        expect(res.body.status.reason).toContain('SLACK_ENABLED=false');
    });
});
