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
import { generateWeeklyReport } from '../../application/generateWeeklyReport.js';
import logger from '../../infrastructure/logger.js';

const WRITABLE_KEYS = new Set(WRITABLE_SETTINGS.map(setting => setting.key));

export function createSettingsRoutes(cache) {
    const router = express.Router();

    // GET /settings
    router.get('/', (_req, res) => {
        res.json(describeSettings());
    });

    // GET /settings/email — provider catalog plus the current configuration
    router.get('/email', (_req, res) => {
        res.json(describeEmailConfig());
    });

    // PUT /settings/email — pick a provider and store its credentials
    router.put('/email', (req, res) => {
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
            const result = saveEmailConfig(
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
    router.get('/slack', (_req, res) => {
        res.json(describeSlackConfig());
    });

    // PUT /settings/slack — webhook or bot token, plus the destination
    router.put('/slack', (req, res) => {
        const body = req.body ?? {};

        // Field by field rather than all or nothing: SLACK_WEBHOOK_URL pins how
        // alerts are delivered, but the signing secret and the app credentials
        // can still be managed here.
        const pinned = [];
        const pins = (value, envVar) => {
            if (value !== undefined && process.env[envVar] !== undefined) pinned.push(envVar);
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
                saveSlackConfig(
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

    // POST /settings/email/test — verify the connection, or send a real message
    router.post('/email/test', async (req, res) => {
        const send = req.body?.send === true;

        try {
            if (!send) {
                return res.json(await verifyEmailTransport());
            }

            // Sends the current digest when there is one, so the operator sees
            // the real template rather than an empty sample.
            const report = cache ? generateWeeklyReport(cache.getAll()) : null;
            const result = await sendTestEmail(report);

            res.status(result.ok ? 200 : 400).json(result);
        } catch (error) {
            logger.error({ err: error }, 'Email test failed');
            res.status(500).json({ error: error.message });
        }
    });

    // PUT /settings — partial update of the writable whitelist
    router.put('/', (req, res) => {
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
                applied[key] = value === null ? (clearSetting(key), null) : setSetting(key, value, changedBy ?? 'api');
            }

            logger.info({ keys: Object.keys(applied), changedBy }, 'Settings updated via API');
            res.json({ applied, ...describeSettings() });
        } catch (error) {
            logger.warn({ err: error }, 'Settings update failed');
            res.status(400).json({ error: error.message });
        }
    });

    return router;
}
