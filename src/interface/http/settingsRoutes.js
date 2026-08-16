import express from 'express';
import {
    describeSettings,
    setSetting,
    clearSetting,
    isEnvLocked,
    WRITABLE_SETTINGS,
} from '../../infrastructure/settings.js';
import {
    describeEmailConfig,
    saveEmailConfig,
    isEnvConfigured,
} from '../../infrastructure/notifiers/emailConfig.js';
import { verifyEmailTransport, sendTestEmail } from '../../infrastructure/notifiers/emailNotifier.js';
import {
    describeSlackConfig,
    saveSlackConfig,
    isEnvConfigured as isSlackEnvConfigured,
} from '../../infrastructure/notifiers/slackConfig.js';
import { sendTestMessage } from '../../infrastructure/notifySlack.js';
import {
    describeLlmConfig,
    saveLlmConfig,
    isEnvConfigured as isLlmEnvConfigured,
} from '../../infrastructure/llm/llmConfig.js';
import { testLLM } from '../../infrastructure/llm/llmAdapter.js';
import {
    describeTeamsConfig,
    saveTeamsConfig,
    isEnvConfigured as isTeamsEnvConfigured,
} from '../../infrastructure/notifiers/teamsConfig.js';
import { sendTeamsTestMessage } from '../../infrastructure/notifiers/notifyTeams.js';
import {
    describeTelegramConfig,
    saveTelegramConfig,
    isEnvConfigured as isTelegramEnvConfigured,
} from '../../infrastructure/notifiers/telegramConfig.js';
import { sendTelegramTestMessage } from '../../infrastructure/notifiers/notifyTelegram.js';
import {
    registerTelegramWebhook,
    describeTelegramWebhook,
    deleteTelegramWebhook,
} from '../../infrastructure/notifiers/telegramWebhook.js';
import { resolvePublicUrl, currentCallbackUrl } from '../../infrastructure/callbackUrls.js';
import { buildReport } from '../../application/buildReport.js';
import logger from '../../infrastructure/logger.js';

const WRITABLE_KEYS = new Set(WRITABLE_SETTINGS.map(setting => setting.key));

export function createSettingsRoutes(cache) {
    const router = express.Router();

    // GET /settings
    router.get('/', async (_req, res) => {
        res.json(await describeSettings());
    });

    // GET /settings/email — provider catalog plus the current configuration
    router.get('/email', async (_req, res) => {
        res.json(await describeEmailConfig());
    });

    // PUT /settings/email — pick a provider and store its credentials
    router.put('/email', async (req, res) => {
        if (isEnvConfigured()) {
            return res.status(409).json({
                error: 'Email is pinned by SMTP_HOST in the environment',
                hint: 'Unset SMTP_HOST (and the other SMTP_/EMAIL_ variables) to manage delivery from the console.',
            });
        }

        const { provider, host, port, username, secret, from, recipients, template, enabled, changedBy } =
            req.body ?? {};

        if (!provider) {
            return res.status(400).json({ error: 'provider is required' });
        }

        try {
            const result = await saveEmailConfig(
                { provider, host, port, username, secret, from, recipients, template, enabled },
                changedBy ?? 'api'
            );
            res.json(result);
        } catch (error) {
            logger.warn({ err: error }, 'Email configuration update failed');
            res.status(400).json({ error: error.message });
        }
    });

    // GET /settings/slack — where alerts go, and how
    router.get('/slack', async (_req, res) => {
        res.json(await describeSlackConfig());
    });

    // PUT /settings/slack — webhook or bot token, plus the destination
    router.put('/slack', async (req, res) => {
        const body = req.body ?? {};

        // Field by field rather than all or nothing: SLACK_WEBHOOK_URL pins how
        // alerts are delivered, but the signing secret and the app credentials
        // can still be managed here.
        const pinned = [];
        const pins = (value, envVar) => {
            // Empty is not a pin. `SLACK_SIGNING_SECRET=` in a .env leaves the
            // variable defined but carrying nothing, and everywhere else in the
            // product that reads as unset — including the field the console
            // renders. Refusing the write on it made the guard disagree with
            // the form: enabled, editable, and 409 on save.
            if (value !== undefined && Boolean(process.env[envVar])) pinned.push(envVar);
        };

        if (isSlackEnvConfigured()) {
            // The env webhook decides where alerts go, so the destination is
            // not the console's to change. `mode` is left out on purpose: it is
            // ignored while the environment pins the transport, and the form
            // always sends it.
            for (const field of ['webhookUrl', 'destination', 'notifyOwners']) {
                if (body[field] !== undefined) {
                    pinned.push('SLACK_WEBHOOK_URL');
                    break;
                }
            }
        }
        pins(body.signingSecret, 'SLACK_SIGNING_SECRET');
        pins(body.appToken, 'SLACK_APP_TOKEN');
        pins(body.appId, 'SLACK_APP_ID');
        pins(body.enabled, 'SLACK_ENABLED');

        if (pinned.length > 0) {
            return res.status(409).json({
                error: 'One or more values are pinned by an environment variable',
                pinned: [...new Set(pinned)],
                hint: 'Unset them to manage these from the console.',
            });
        }

        const {
            mode,
            webhookUrl,
            botToken,
            signingSecret,
            appToken,
            appId,
            destination,
            notifyOwners,
            enabled,
            changedBy,
        } = req.body ?? {};

        try {
            res.json(
                await saveSlackConfig(
                    { mode, webhookUrl, botToken, signingSecret, appToken, appId, destination, notifyOwners, enabled },
                    changedBy ?? 'api'
                )
            );
        } catch (error) {
            logger.warn({ err: error }, 'Slack configuration update failed');
            res.status(400).json({ error: error.message });
        }
    });

    // POST /settings/slack/test — post a real message to the destination
    router.post('/slack/test', async (_req, res) => {
        try {
            const result = await sendTestMessage();
            res.status(result.ok ? 200 : 400).json(result);
        } catch (error) {
            logger.error({ err: error }, 'Slack test failed');
            res.status(500).json({ error: error.message });
        }
    });

    // GET /settings/teams — the channel webhook, if any
    router.get('/teams', async (_req, res) => {
        res.json(await describeTeamsConfig());
    });

    // PUT /settings/teams
    router.put('/teams', async (req, res) => {
        if (isTeamsEnvConfigured()) {
            return res.status(409).json({
                error: 'Teams is pinned by TEAMS_WEBHOOK_URL in the environment',
                hint: 'Unset TEAMS_WEBHOOK_URL to manage it from the console.',
            });
        }

        const { webhookUrl, enabled, changedBy } = req.body ?? {};

        try {
            res.json(await saveTeamsConfig({ webhookUrl, enabled }, changedBy ?? 'api'));
        } catch (error) {
            logger.warn({ err: error }, 'Teams configuration update failed');
            res.status(400).json({ error: error.message });
        }
    });

    // POST /settings/teams/test — post a real card to the channel
    router.post('/teams/test', async (_req, res) => {
        try {
            const result = await sendTeamsTestMessage();
            res.status(result.ok ? 200 : 400).json(result);
        } catch (error) {
            logger.error({ err: error }, 'Teams test failed');
            res.status(500).json({ error: error.message });
        }
    });

    // GET /settings/telegram — the bot, the chat, and what Telegram was told
    router.get('/telegram', async (_req, res) => {
        const described = await describeTelegramConfig();

        // What Telegram itself thinks, including its last delivery error —
        // the only place a webhook that stopped working ever says so.
        let live = null;
        try {
            live = await describeTelegramWebhook();
        } catch (error) {
            logger.debug({ err: error }, 'Could not read the Telegram webhook state');
        }

        res.json({ ...described, webhook: { ...described.webhook, live } });
    });

    // PUT /settings/telegram
    router.put('/telegram', async (req, res) => {
        if (isTelegramEnvConfigured()) {
            return res.status(409).json({
                error: 'Telegram is pinned by TELEGRAM_BOT_TOKEN in the environment',
                hint: 'Unset TELEGRAM_BOT_TOKEN to manage it from the console.',
            });
        }

        const { botToken, chatId, notifyOwners, enabled, changedBy } = req.body ?? {};

        try {
            res.json(
                await saveTelegramConfig({ botToken, chatId, notifyOwners, enabled }, changedBy ?? 'api')
            );
        } catch (error) {
            logger.warn({ err: error }, 'Telegram configuration update failed');
            res.status(400).json({ error: error.message });
        }
    });

    // POST /settings/telegram/test — post a real message to the chat
    router.post('/telegram/test', async (_req, res) => {
        try {
            const result = await sendTelegramTestMessage();
            res.status(result.ok ? 200 : 400).json(result);
        } catch (error) {
            logger.error({ err: error }, 'Telegram test failed');
            res.status(500).json({ error: error.message });
        }
    });

    // POST /settings/telegram/webhook — point the bot at this instance.
    //
    // The URL is not something the console can know: it is where *this* API
    // answers from, which is PUBLIC_URL, or the tunnel the process opened.
    router.post('/telegram/webhook', async (req, res) => {
        // Whatever this process is actually reachable at, which on a tunnel is
        // a hostname only it knows. Asking PUBLIC_URL alone would report "no
        // public URL" while a perfectly good tunnel was open.
        const callback = currentCallbackUrl();
        const url = req.body?.url ?? callback.url ?? resolvePublicUrl();

        if (!url) {
            return res.status(400).json({
                error: `No public URL to register — ${
                    callback.reason ?? 'this instance has no address the internet can reach'
                }`,
                hint: 'Set PUBLIC_URL, or TUNNEL_PROVIDER=cloudflared to open one on boot (no account needed), or pass { "url": "https://…" }.',
            });
        }

        try {
            const result = await registerTelegramWebhook(url, { force: true });
            res.status(result.registered ? 200 : 400).json(result);
        } catch (error) {
            logger.warn({ err: error }, 'Telegram webhook registration failed');
            res.status(400).json({ error: error.message });
        }
    });

    // DELETE /settings/telegram/webhook — stop Telegram calling a dead tunnel
    router.delete('/telegram/webhook', async (_req, res) => {
        try {
            const removed = await deleteTelegramWebhook();
            if (!removed) return res.status(400).json({ error: 'Telegram is not configured' });
            res.json({ removed: true });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    // GET /settings/llm — provider catalog and the current model
    router.get('/llm', async (_req, res) => {
        res.json(await describeLlmConfig());
    });

    // PUT /settings/llm — pick a model, local or hosted
    router.put('/llm', async (req, res) => {
        if (isLlmEnvConfigured()) {
            return res.status(409).json({
                error: 'The LLM provider is pinned by LLM_PROVIDER in the environment',
                hint: 'Unset LLM_PROVIDER (and the OPENAI_/OLLAMA_ variables) to manage it from the console.',
            });
        }

        const { provider, model, baseUrl, apiKey, enabled, changedBy } = req.body ?? {};

        if (!provider) return res.status(400).json({ error: 'provider is required' });

        try {
            res.json(await saveLlmConfig({ provider, model, baseUrl, apiKey, enabled }, changedBy ?? 'api'));
        } catch (error) {
            logger.warn({ err: error }, 'LLM configuration update failed');
            res.status(400).json({ error: error.message });
        }
    });

    // POST /settings/llm/test — one short prompt against the configured model
    router.post('/llm/test', async (_req, res) => {
        try {
            const result = await testLLM();
            res.status(result.ok ? 200 : 400).json(result);
        } catch (error) {
            logger.error({ err: error }, 'LLM test failed');
            res.status(500).json({ error: error.message });
        }
    });

    // POST /settings/email/test — verify the connection, or send a real message
    router.post('/email/test', async (req, res) => {
        const send = req.body?.send === true;

        try {
            if (!send) {
                return res.json(await verifyEmailTransport());
            }

            // Sends the current digest when there is one, so the operator sees
            // the real template rather than an empty sample.
            const report = cache ? await buildReport(cache) : null;
            const result = await sendTestEmail(report);

            res.status(result.ok ? 200 : 400).json(result);
        } catch (error) {
            logger.error({ err: error }, 'Email test failed');
            res.status(500).json({ error: error.message });
        }
    });

    // PUT /settings — partial update of the writable whitelist
    router.put('/', async (req, res) => {
        const { settings, changedBy } = req.body ?? {};

        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            return res.status(400).json({ error: 'settings must be an object of key/value pairs' });
        }

        // Reject the whole payload if any key is outside the whitelist. A
        // partial apply would leave the caller guessing which writes landed,
        // and silently dropping a key like slack.webhookUrl would read as
        // success while the secret stayed untouched.
        const rejected = Object.keys(settings).filter(key => !WRITABLE_KEYS.has(key));
        if (rejected.length > 0) {
            return res.status(400).json({
                error: 'One or more settings are not writable',
                rejected,
                writable: [...WRITABLE_KEYS],
            });
        }

        // Refuse rather than store a value the environment already overrides —
        // the write would persist and still have no effect on behaviour.
        const locked = Object.keys(settings).filter(isEnvLocked);
        if (locked.length > 0) {
            return res.status(409).json({
                error: 'One or more settings are pinned by an environment variable',
                locked,
                hint: 'Unset the environment variable to manage these from the console.',
            });
        }

        try {
            const applied = {};
            for (const [key, value] of Object.entries(settings)) {
                if (value === null) {
                    await clearSetting(key);
                    applied[key] = null;
                } else {
                    applied[key] = await setSetting(key, value, changedBy ?? 'api');
                }
            }

            logger.info({ keys: Object.keys(applied), changedBy }, 'Settings updated via API');
            res.json({ applied, ...(await describeSettings()) });
        } catch (error) {
            logger.warn({ err: error }, 'Settings update failed');
            res.status(400).json({ error: error.message });
        }
    });

    return router;
}
