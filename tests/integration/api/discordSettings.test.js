/**
 * Integration tests for Discord delivery settings.
 *
 * Nothing leaves the process: axios is stubbed, so "Send test" is exercised
 * without a network. What is under test is the storage, the rules around the
 * credential, and that the embed says what it claims to say.
 */
import { jest } from '@jest/globals';

const post = jest.fn();
jest.unstable_mockModule('axios', () => ({ default: { post, get: jest.fn() } }));

const { test, expect, beforeAll, afterAll, beforeEach } = await import('@jest/globals');
const request = (await import('supertest')).default;
const {
    describeWithDatabase: describe,
    hasDatabase,
    useSchema,
    setUpSchema,
    tearDownSchema,
    truncateAll,
} = await import('../../helpers/postgres.js');
const { listening, closeServer } = await import('../../helpers/server.js');

const { schema } = useSchema('discord_settings');
process.env.API_KEY = 'test-api-key';
process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key';

const cache = await import('#app/infrastructure/cache/postgresCache.js');
const { initializeDatabase } = cache;
const { createApp } = await import('#app/interface/http/createApp.js');
const { queryOne } = await import('#app/infrastructure/db/pool.js');
const { buildDiscordMessage } = await import('#app/infrastructure/notifiers/notifyDiscord.js');

// Cleared *after* the imports: config.js calls dotenv.config(), which would
// otherwise repopulate them from the developer's .env.
const ENV_KEYS = ['DISCORD_WEBHOOK_URL', 'DISCORD_ENABLED'];
for (const key of ENV_KEYS) delete process.env[key];

const KEY = { 'X-API-Key': 'test-api-key' };
const WEBHOOK = 'https://discord.com/api/webhooks/123456789/aVeryLongOpaqueTokenEnding9999';
let app;

beforeAll(async () => {
    if (!hasDatabase) return;
    await setUpSchema(schema);
    await initializeDatabase();
    app = await listening(createApp(cache));
});

afterAll(async () => {
    if (!hasDatabase) return;
    await closeServer(app);
    await tearDownSchema(schema);
});

beforeEach(async () => {
    if (!hasDatabase) return;
    await truncateAll();
    for (const key of ENV_KEYS) delete process.env[key];
    post.mockReset();
    post.mockResolvedValue({ status: 204, data: '' });
});

describe('the Discord webhook', () => {
    test('starts unconfigured, and says so rather than looking broken', async () => {
        const res = await request(app).get('/api/v1/settings/discord').set(KEY);

        expect(res.status).toBe(200);
        expect(res.body.config).toMatchObject({ hasWebhook: false, webhookHint: null, enabled: false });
        expect(res.body.status).toMatchObject({ ready: false, source: 'none' });
    });

    test('is stored encrypted, and the row never holds the URL', async () => {
        await request(app)
            .put('/api/v1/settings/discord')
            .set(KEY)
            .send({ webhookUrl: WEBHOOK, enabled: true });

        const row = await queryOne('SELECT * FROM discord_config WHERE id = 1');

        expect(row.webhook_cipher).toBeTruthy();
        expect(row.webhook_cipher).not.toContain('aVeryLongOpaqueToken');
        expect(row.webhook_cipher).not.toContain('discord.com');
    });

    // The rule across every integration: no endpoint returns a stored secret in
    // any shape, only that one exists and its last four characters.
    test('is never returned, in any shape', async () => {
        await request(app)
            .put('/api/v1/settings/discord')
            .set(KEY)
            .send({ webhookUrl: WEBHOOK, enabled: true });

        const res = await request(app).get('/api/v1/settings/discord').set(KEY);
        const body = JSON.stringify(res.body);

        expect(body).not.toContain('aVeryLongOpaqueToken');
        expect(body).not.toContain('discord.com');
        expect(res.body.config).toMatchObject({ hasWebhook: true, enabled: true });
        // maskSecret keeps the last four characters and hides the rest.
        expect(res.body.config.webhookHint).toBe('••••9999');
    });

    test('clears when given an empty string', async () => {
        await request(app).put('/api/v1/settings/discord').set(KEY).send({ webhookUrl: WEBHOOK, enabled: true });
        await request(app).put('/api/v1/settings/discord').set(KEY).send({ webhookUrl: '' });

        const res = await request(app).get('/api/v1/settings/discord').set(KEY);

        expect(res.body.config).toMatchObject({ hasWebhook: false, webhookHint: null });
        expect(res.body.status.ready).toBe(false);
    });

    test('a URL that is not a Discord webhook is refused with a reason', async () => {
        const res = await request(app)
            .put('/api/v1/settings/discord')
            .set(KEY)
            .send({ webhookUrl: 'https://example.com/hooks/abc' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/discord\.com\/api\/webhooks/);
    });

    test.each([
        'https://discord.com/api/webhooks/1/abc9999',
        'https://discordapp.com/api/webhooks/1/abc9999',
        'https://canary.discord.com/api/webhooks/1/abc9999',
        'https://ptb.discord.com/api/webhooks/1/abc9999',
    ])('%s is accepted', async webhookUrl => {
        const res = await request(app).put('/api/v1/settings/discord').set(KEY).send({ webhookUrl });

        expect(res.status).toBe(200);
    });
});

describe('when the environment pins it', () => {
    // A write that would have no effect is refused rather than silently ignored.
    test('the write is refused with 409, and says what to unset', async () => {
        process.env.DISCORD_WEBHOOK_URL = WEBHOOK;

        const res = await request(app)
            .put('/api/v1/settings/discord')
            .set(KEY)
            .send({ webhookUrl: 'https://discord.com/api/webhooks/2/other9999' });

        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/DISCORD_WEBHOOK_URL/);
        expect(res.body.hint).toMatch(/Unset/);
    });

    test('the console is told the field is locked, and by which variable', async () => {
        process.env.DISCORD_WEBHOOK_URL = WEBHOOK;

        const res = await request(app).get('/api/v1/settings/discord').set(KEY);

        expect(res.body.envLocked).toBe(true);
        expect(res.body.envVars).toContain('DISCORD_WEBHOOK_URL');
        expect(res.body.status).toMatchObject({ ready: true, source: 'env' });
    });

    test('DISCORD_ENABLED=false switches it off without unsetting the URL', async () => {
        process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
        process.env.DISCORD_ENABLED = 'false';

        const res = await request(app).get('/api/v1/settings/discord').set(KEY);

        expect(res.body.status.ready).toBe(false);
        expect(res.body.status.reason).toMatch(/switched off/);
    });
});

describe('the test send', () => {
    test('refuses before there is anywhere to send to', async () => {
        const res = await request(app).post('/api/v1/settings/discord/test').set(KEY);

        expect(res.status).toBe(400);
        expect(res.body.ok).toBe(false);
        expect(post).not.toHaveBeenCalled();
    });

    test('posts an embed to the stored webhook', async () => {
        await request(app).put('/api/v1/settings/discord').set(KEY).send({ webhookUrl: WEBHOOK, enabled: true });

        const res = await request(app).post('/api/v1/settings/discord/test').set(KEY);

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);

        const [url, payload] = post.mock.calls[0];
        expect(url).toBe(WEBHOOK);
        expect(payload.embeds[0].title).toContain('Atalaia is connected');
    });

    // A webhook Discord has deleted answers 404, and the console should say that
    // rather than "ok".
    test('a rejected webhook is reported, not swallowed', async () => {
        await request(app).put('/api/v1/settings/discord').set(KEY).send({ webhookUrl: WEBHOOK, enabled: true });
        post.mockRejectedValue(
            Object.assign(new Error('Request failed with status code 404'), {
                response: { status: 404, data: { message: 'Unknown Webhook', code: 10015 } },
            })
        );

        const res = await request(app).post('/api/v1/settings/discord/test').set(KEY);

        expect(res.status).toBe(400);
        expect(res.body.ok).toBe(false);
        expect(res.body.error).toMatch(/Discord webhook failed/);
    });
});

describe('the alert embed', () => {
    const vuln = {
        cveId: 'CVE-2026-1234',
        title: 'Remote code execution in libthing',
        description: 'An unauthenticated attacker can run code.',
        severity: 'CRITICAL',
        cvssScore: 9.8,
        source: 'nvd',
        affectedTechnologies: ['libthing'],
        link: 'https://nvd.nist.gov/vuln/detail/CVE-2026-1234',
        exploited: true,
        publishedDate: new Date('2026-08-18T00:00:00Z'),
        isCritical: () => true,
        isExploited: () => true,
    };

    test('says which CVE, how bad, and where to read more', () => {
        const [embed] = buildDiscordMessage(vuln).embeds;

        expect(embed.title).toContain('Remote code execution in libthing');
        expect(embed.url).toBe(vuln.link);
        expect(embed.fields.find(f => f.name === 'Severity').value).toContain('9.8');
        expect(embed.fields.find(f => f.name === 'CVE').value).toBe('CVE-2026-1234');
    });

    // Exploitation is the thing that changes what someone does today.
    test('an exploited vulnerability leads with that', () => {
        expect(buildDiscordMessage(vuln).embeds[0].title).toContain('Exploited');
    });

    test('the affected repositories are named', () => {
        const [embed] = buildDiscordMessage(vuln, {
            affectedRepositories: [{ name: 'acme/api' }, { name: 'acme/web' }],
            owners: [{ name: 'Platform' }],
        }).embeds;

        expect(embed.fields.find(f => f.name === 'Affected repositories').value).toBe('acme/api, acme/web');
        expect(embed.fields.find(f => f.name === 'Owners').value).toBe('Platform');
    });

    test('a long list of repositories says how many more', () => {
        const many = Array.from({ length: 9 }, (_unused, index) => ({ name: `acme/repo-${index}` }));
        const [embed] = buildDiscordMessage(vuln, { affectedRepositories: many }).embeds;

        expect(embed.fields.find(f => f.name === 'Affected repositories').value).toMatch(/and 4 more$/);
    });

    // Discord rejects an over-long payload outright rather than trimming it, so
    // an untruncated alert would be lost rather than shortened.
    test('an enormous description is truncated rather than rejected', () => {
        const [embed] = buildDiscordMessage({ ...vuln, description: 'x'.repeat(9000) }).embeds;

        expect(embed.description.length).toBeLessThanOrEqual(4096);
        expect(embed.description.endsWith('…')).toBe(true);
    });

    test('a vulnerability with no description says so rather than showing nothing', () => {
        const [embed] = buildDiscordMessage({ ...vuln, description: null, clientExplanation: null }).embeds;

        expect(embed.description).toBe('No description available.');
    });

    test('severity picks the colour, and an unknown one still has one', () => {
        expect(buildDiscordMessage(vuln).embeds[0].color).toBe(0xd7_3a_4a);
        expect(buildDiscordMessage({ ...vuln, severity: 'Unknown' }).embeds[0].color).toBe(0x6a_73_7d);
    });
});
