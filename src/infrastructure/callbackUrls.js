import logger from './logger.js';
import { updateSlackRequestUrl } from './slackUrlUpdater.js';
import { resolveAppCredentials } from './notifiers/slackConfig.js';

/**
 * Telling the chat platforms where to call back.
 *
 * Slack and Telegram each hold their own copy of the URL, and both have to be
 * told again every time it changes — which, on a development tunnel, is every
 * restart. One place does it so a new integration is a line here rather than
 * another block in the process entry point.
 */

/**
 * An address the internet can already reach, if there is one.
 *
 * PUBLIC_URL is what a real deployment sets. It wins over any tunnel: a
 * hostname somebody owns should not be replaced by a throwaway one.
 *
 * @returns {string|null}
 */
export function resolvePublicUrl() {
    const url = process.env.PUBLIC_URL?.trim();
    if (!url) return null;

    return url.replace(/\/+$/, '');
}

/**
 * @param {string} publicUrl Base URL, no trailing slash
 * @returns {Promise<{ slack: boolean }>} Which platforms accepted it
 */
export async function publishCallbackUrl(publicUrl) {
    const results = { slack: false };

    try {
        // Environment first, then whatever the console stored.
        const { appToken, appId } = await resolveAppCredentials();
        results.slack = await updateSlackRequestUrl(publicUrl, appToken, appId);
    } catch (err) {
        logger.warn({ err }, 'Could not update the Slack request URL');
    }

    logger.info({ publicUrl, ...results }, 'Callback URL published');
    return results;
}
