/**
 * Telegram: configuration, the webhook endpoint, and the button callbacks.
 *
 * Nothing here talks to Telegram — axios is stubbed — so what is exercised is
 * what Atalaia decides: what it stores, what it hides, what it refuses, and
 * what a button press does to a vulnerability.
 */
import { test, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import {
    describeWithDatabase as describe,
    hasDatabase,
    useSchema,
    setUpSchema,
    tearDownSchema,
    truncateAll,
} from '../../helpers/postgres.js';

const { schema } = useSchema('telegram_settings');

process.env.API_KEY = 'test-api-key';

// Stubbed before the modules that use it are imported.
const post = jest.fn();
jest.unstable_mockModule('axios', () => ({ default: { post }, post }));

const { initializeDatabase } = await import('#app/infrastructure/cache/postgresCache.js');
const cache = await import('#app/infrastructure/cache/postgresCache.js');
const { createApp } = await import('#app/interface/http/createApp.js');
const { query } = await import('#app/infrastructure/db/pool.js');
const { ensureWebhookSecret, saveTelegramConfig } = await import(
    '#app/infrastructure/notifiers/telegramConfig.js'
);
const { buildVulnerabilityMessage, escapeHtml } = await import(
    '#app/infrastructure/notifiers/notifyTelegram.js'
);

delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;
delete process.env.TELEGRAM_ENABLED;

const KEY = { 'X-API-Key': 'test-api-key' };
const TOKEN = '123456789:AAFakeTokenForTestsOnly-0123456789ab';

let app;

/** Telegram answers 200 with ok:true; failures are ok:false in the body. */
function telegramReplies(result = {}) {
    post.mockResolvedValue({ status: 200, data: { ok: true, result } });
}

async function seedVuln(cveId, status = 'OPEN') {
    await query(
        `INSERT INTO vulnerabilities (cve_id, title, severity, source, status)
         VALUES (@cveId, 'Something bad', 'CRITICAL', 'nvd', @status)`,
        { cveId, status }
    );
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
    post.mockReset();
    telegramReplies();
});

describe('the configuration', () => {
    test('reports itself unconfigured before anything is saved', async () => {
        const res = await request(app).get('/api/v1/settings/telegram').set(KEY);

        expect(res.status).toBe(200);
        expect(res.body.status.ready).toBe(false);
        expect(res.body.config.hasToken).toBe(false);
    });

    test('stores the token but never returns it', async () => {
        const res = await request(app)
            .put('/api/v1/settings/telegram')
            .set(KEY)
            .send({ botToken: TOKEN, chatId: '-1001234567890', enabled: true });

        expect(res.status).toBe(200);
        expect(res.body.config.hasToken).toBe(true);
        expect(res.body.config.chatId).toBe('-1001234567890');
        expect(res.body.status.ready).toBe(true);
        expect(JSON.stringify(res.body)).not.toContain(TOKEN);
        // Only the last four characters, as everywhere else.
        expect(res.body.config.tokenHint).toMatch(/9ab$/);
    });

    test('refuses something that is not a bot token', async () => {
        const res = await request(app)
            .put('/api/v1/settings/telegram')
            .set(KEY)
            .send({ botToken: 'hunter2', chatId: '1' });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('BotFather');
    });

    test('a chat id without a token is not ready, and says why', async () => {
        await request(app).put('/api/v1/settings/telegram').set(KEY).send({ chatId: '55', enabled: true });

        const res = await request(app).get('/api/v1/settings/telegram').set(KEY);
        expect(res.body.status.ready).toBe(false);
        expect(res.body.status.reason).toContain('no bot token');
    });

    test('the environment pins it, and the write is refused rather than ignored', async () => {
        process.env.TELEGRAM_BOT_TOKEN = TOKEN;

        try {
            const res = await request(app)
                .put('/api/v1/settings/telegram')
                .set(KEY)
                .send({ chatId: '1' });

            expect(res.status).toBe(409);
            expect(res.body.error).toContain('TELEGRAM_BOT_TOKEN');

            const described = await request(app).get('/api/v1/settings/telegram').set(KEY);
            expect(described.body.envLocked).toBe(true);
        } finally {
            delete process.env.TELEGRAM_BOT_TOKEN;
        }
    });
});

describe('the test message', () => {
    test('says what is missing instead of sending', async () => {
        const res = await request(app).post('/api/v1/settings/telegram/test').set(KEY);

        expect(res.status).toBe(400);
        expect(res.body.ok).toBe(false);
        expect(post).not.toHaveBeenCalled();
    });

    test('posts to the configured chat', async () => {
        await saveTelegramConfig({ botToken: TOKEN, chatId: '-100', enabled: true }, 'test');
        telegramReplies({ chat: { title: 'Security' } });

        const res = await request(app).post('/api/v1/settings/telegram/test').set(KEY);

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        const [url, payload] = post.mock.calls[0];
        expect(url).toContain(`bot${TOKEN}/sendMessage`);
        expect(payload.chat_id).toBe('-100');
    });

    test('reports Telegram\'s own reason for refusing', async () => {
        await saveTelegramConfig({ botToken: TOKEN, chatId: '-100', enabled: true }, 'test');
        post.mockResolvedValue({ status: 400, data: { ok: false, description: 'chat not found' } });

        const res = await request(app).post('/api/v1/settings/telegram/test').set(KEY);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('chat not found');
    });
});

describe('the webhook endpoint', () => {
    test('rejects a callback with no secret token', async () => {
        await ensureWebhookSecret();

        const res = await request(app)
            .post('/api/v1/telegram/webhook')
            .send({ callback_query: { id: '1', data: 'ack:CVE-2024-0001' } });

        expect(res.status).toBe(401);
    });

    test('rejects a callback with the wrong secret token', async () => {
        await ensureWebhookSecret();

        const res = await request(app)
            .post('/api/v1/telegram/webhook')
            .set('X-Telegram-Bot-Api-Secret-Token', 'not-the-secret')
            .send({ callback_query: { id: '1', data: 'ack:CVE-2024-0001' } });

        expect(res.status).toBe(401);
    });

    test('refuses everything when no secret is stored', async () => {
        const res = await request(app)
            .post('/api/v1/telegram/webhook')
            .set('X-Telegram-Bot-Api-Secret-Token', 'anything')
            .send({ callback_query: { id: '1', data: 'ack:CVE-2024-0001' } });

        expect(res.status).toBe(500);
    });

    test('Acknowledge moves the vulnerability and records who pressed it', async () => {
        const secret = await ensureWebhookSecret();
        await saveTelegramConfig({ botToken: TOKEN, chatId: '-100', enabled: true }, 'test');
        await seedVuln('CVE-2024-0001');

        const res = await request(app)
            .post('/api/v1/telegram/webhook')
            .set('X-Telegram-Bot-Api-Secret-Token', secret)
            .send({
                callback_query: {
                    id: '99',
                    data: 'ack:CVE-2024-0001',
                    from: { id: 42, username: 'jackson' },
                    message: { message_id: 7, chat: { id: -100 } },
                },
            });

        expect(res.status).toBe(200);

        const stored = await cache.get('CVE-2024-0001');
        expect(stored.status).toBe('ACKNOWLEDGED');
        expect(stored.status_changed_by).toBe('telegram:@jackson');
    });

    test('Resolve resolves it', async () => {
        const secret = await ensureWebhookSecret();
        await seedVuln('CVE-2024-0002');

        await request(app)
            .post('/api/v1/telegram/webhook')
            .set('X-Telegram-Bot-Api-Secret-Token', secret)
            .send({
                callback_query: { id: '1', data: 'resolve:CVE-2024-0002', from: { id: 7 } },
            });

        expect((await cache.get('CVE-2024-0002')).status).toBe('RESOLVED');
    });

    test('an unknown button is answered, not retried', async () => {
        const secret = await ensureWebhookSecret();

        const res = await request(app)
            .post('/api/v1/telegram/webhook')
            .set('X-Telegram-Bot-Api-Secret-Token', secret)
            .send({ callback_query: { id: '1', data: 'launch:missiles', from: { id: 7 } } });

        // 200 on purpose: Telegram redelivers anything else, forever.
        expect(res.status).toBe(200);
    });

    test('a plain message is ignored', async () => {
        const secret = await ensureWebhookSecret();

        const res = await request(app)
            .post('/api/v1/telegram/webhook')
            .set('X-Telegram-Bot-Api-Secret-Token', secret)
            .send({ message: { text: 'hello' } });

        expect(res.status).toBe(200);
        expect(post).not.toHaveBeenCalled();
    });
});

describe('registering the webhook', () => {
    test('refuses when there is no public URL to register', async () => {
        const res = await request(app).post('/api/v1/settings/telegram/webhook').set(KEY).send({});

        expect(res.status).toBe(400);
        expect(res.body.hint).toContain('PUBLIC_URL');
    });

    test('registers the callback path, asking for buttons and messages', async () => {
        await saveTelegramConfig({ botToken: TOKEN, chatId: '-100', enabled: true }, 'test');

        const res = await request(app)
            .post('/api/v1/settings/telegram/webhook')
            .set(KEY)
            .send({ url: 'https://example.trycloudflare.com' });

        expect(res.status).toBe(200);
        expect(res.body.url).toBe('https://example.trycloudflare.com/api/v1/telegram/webhook');

        const call = post.mock.calls.find(([url]) => url.includes('setWebhook'));
        expect(call[1].allowed_updates).toEqual(['callback_query', 'message']);
        expect(call[1].secret_token).toHaveLength(64);
    });
});

describe('the message itself', () => {
    test('carries both buttons, keyed by CVE', () => {
        const message = buildVulnerabilityMessage({
            cveId: 'CVE-2024-0003',
            title: 'Bad thing',
            severity: 'CRITICAL',
            source: 'nvd',
        });

        const [ack, resolve] = message.reply_markup.inline_keyboard[0];
        expect(ack.callback_data).toBe('ack:CVE-2024-0003');
        expect(resolve.callback_data).toBe('resolve:CVE-2024-0003');
        // Telegram's own limit on callback data.
        expect(Buffer.byteLength(ack.callback_data)).toBeLessThanOrEqual(64);
    });

    test('escapes a title that would otherwise break the markup', () => {
        const message = buildVulnerabilityMessage({
            cveId: 'CVE-2024-0004',
            title: '<script>alert("x")</script> & friends',
            severity: 'HIGH',
            source: 'ghsa',
        });

        expect(message.text).not.toContain('<script>');
        expect(message.text).toContain('&lt;script&gt;');
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('stays inside Telegram\'s length limit', () => {
        const message = buildVulnerabilityMessage({
            cveId: 'CVE-2024-0005',
            title: 'x'.repeat(500),
            description: 'y'.repeat(9000),
            severity: 'LOW',
            source: 'nvd',
        });

        expect(message.text.length).toBeLessThanOrEqual(4096);
    });

    test('names the repositories it reaches', () => {
        const message = buildVulnerabilityMessage(
            { cveId: 'CVE-2024-0006', title: 'Reaches us', severity: 'HIGH', source: 'ghsa' },
            { affectedRepositories: [{ name: 'acme/api', url: 'https://github.com/acme/api' }] }
        );

        expect(message.text).toContain('acme/api');
    });
});

describe('registering without an address', () => {
    test('says why there is none, and which variable fixes it', async () => {
        const res = await request(app).post('/api/v1/settings/telegram/webhook').set(KEY).send({});

        expect(res.status).toBe(400);
        // The reason comes from the callback state, not from a guess.
        expect(res.body.error).toContain('No public URL');
        expect(res.body.hint).toContain('TUNNEL_PROVIDER');
    });

    test('uses the tunnel this process actually opened', async () => {
        const { establishCallbackUrl } = await import('#app/infrastructure/callbackUrls.js');
        await saveTelegramConfig({ botToken: TOKEN, chatId: '-100', enabled: true }, 'test');

        process.env.PUBLIC_URL = 'https://atalaia.example.com';
        try {
            await establishCallbackUrl(3000);

            const res = await request(app).post('/api/v1/settings/telegram/webhook').set(KEY).send({});

            expect(res.status).toBe(200);
            expect(res.body.url).toBe('https://atalaia.example.com/api/v1/telegram/webhook');
        } finally {
            delete process.env.PUBLIC_URL;
        }
    });
});

describe('registering without a bot token', () => {
    test('the reason arrives as an error, not as a bare 400', async () => {
        const { establishCallbackUrl } = await import('#app/infrastructure/callbackUrls.js');

        process.env.PUBLIC_URL = 'https://atalaia.example.com';
        try {
            await establishCallbackUrl(3000);

            const res = await request(app).post('/api/v1/settings/telegram/webhook').set(KEY).send({});

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('No bot token');
            expect(res.body.hint).toContain('bot token');
        } finally {
            delete process.env.PUBLIC_URL;
        }
    });
});

describe('learning a chat id', () => {
    test('a message to the bot is remembered and answered with the id', async () => {
        const secret = await ensureWebhookSecret();
        // No destination yet: this is the setup conversation.
        await saveTelegramConfig({ botToken: TOKEN, enabled: true }, 'test');

        const res = await request(app)
            .post('/api/v1/telegram/webhook')
            .set('X-Telegram-Bot-Api-Secret-Token', secret)
            .send({
                message: {
                    text: '/start',
                    chat: { id: 987654321, type: 'private', first_name: 'Jackson', username: 'jack' },
                },
            });

        expect(res.status).toBe(200);

        const listed = await request(app).get('/api/v1/settings/telegram/chats').set(KEY);
        expect(listed.body.count).toBe(1);
        expect(listed.body.chats[0]).toMatchObject({ chat_id: '987654321', type: 'private' });

        // The reply carries the id, because that is the whole point.
        const reply = post.mock.calls.find(([url]) => url.includes('sendMessage'));
        expect(reply[1].chat_id).toBe(987654321);
        expect(reply[1].text).toContain('987654321');
    });

    test('a group is remembered under the id a bot must send to', async () => {
        const secret = await ensureWebhookSecret();
        await saveTelegramConfig({ botToken: TOKEN, enabled: true }, 'test');

        await request(app)
            .post('/api/v1/telegram/webhook')
            .set('X-Telegram-Bot-Api-Secret-Token', secret)
            .send({ message: { text: 'hi', chat: { id: -1001234567890, type: 'supergroup', title: 'Security' } } });

        const listed = await request(app).get('/api/v1/settings/telegram/chats').set(KEY);
        expect(listed.body.chats[0]).toMatchObject({ chat_id: '-1001234567890', title: 'Security' });
    });

    test('"chat not found" is explained by the shape of the id', async () => {
        const { hintFor } = await import('#app/infrastructure/notifiers/notifyTelegram.js');

        expect(hintFor('chat not found', '123456789')).toContain('/start');
        expect(hintFor('chat not found', '-1001234567890')).toContain('member of the group');
        expect(hintFor('chat not found', '@someone')).toContain('public channel');
        expect(hintFor('chat not found', '-42')).toContain('-100');
        expect(hintFor('something else', '1')).toBeUndefined();
    });
});

describe('once a destination is configured', () => {
    test('a stranger writing to the bot is ignored, not answered', async () => {
        const secret = await ensureWebhookSecret();
        await saveTelegramConfig({ botToken: TOKEN, chatId: '111', enabled: true }, 'test');

        const res = await request(app)
            .post('/api/v1/telegram/webhook')
            .set('X-Telegram-Bot-Api-Secret-Token', secret)
            .send({ message: { text: '/start', chat: { id: 999, type: 'private', first_name: 'Nosy' } } });

        expect(res.status).toBe(200);
        // Neither remembered nor replied to: the bot is not an id lookup service.
        expect(post.mock.calls.filter(([url]) => url.includes('sendMessage'))).toHaveLength(0);

        const listed = await request(app).get('/api/v1/settings/telegram/chats').set(KEY);
        expect(listed.body.count).toBe(0);
    });

    test('the configured chat still gets an answer', async () => {
        const secret = await ensureWebhookSecret();
        await saveTelegramConfig({ botToken: TOKEN, chatId: '111', enabled: true }, 'test');

        await request(app)
            .post('/api/v1/telegram/webhook')
            .set('X-Telegram-Bot-Api-Secret-Token', secret)
            .send({ message: { text: 'hi', chat: { id: 111, type: 'private', first_name: 'Jackson' } } });

        expect(post.mock.calls.some(([url]) => url.includes('sendMessage'))).toBe(true);
    });
});
