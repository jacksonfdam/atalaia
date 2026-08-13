import express from 'express';
import {
    describeSettings,
    setSetting,
    clearSetting,
    isEnvLocked,
    WRITABLE_SETTINGS,
} from '../../infrastructure/settings.js';
import logger from '../../infrastructure/logger.js';

const WRITABLE_KEYS = new Set(WRITABLE_SETTINGS.map(setting => setting.key));

export function createSettingsRoutes() {
    const router = express.Router();

    // GET /settings
    router.get('/', (_req, res) => {
        res.json(describeSettings());
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
