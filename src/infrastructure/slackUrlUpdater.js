import axios from 'axios';
import logger from './logger.js';

/**
 * Update Slack app's Request URL via the Slack API.
 * Allows Slack to send interactive button events to the app.
 *
 * @param {string} ngrokUrl - Public ngrok URL (e.g., https://abc123.ngrok.io)
 * @param {string} appToken - Slack app token (SLACK_APP_TOKEN env var)
 * @param {string} appId - Slack app ID (SLACK_APP_ID env var)
 * @returns {Promise<boolean>} - true if successful, false otherwise
 */
export async function updateSlackRequestUrl(ngrokUrl, appToken, appId) {
    // Validate inputs
    if (!ngrokUrl || !appToken || !appId) {
        logger.info(
            { hasUrl: !!ngrokUrl, hasToken: !!appToken, hasAppId: !!appId },
            'Slack credentials missing; skipping Request URL update'
        );
        return false;
    }

    const requestUrl = `${ngrokUrl}/api/v1/slack/actions`;

    try {
        // Call Slack API to update the app manifest
        // https://api.slack.com/methods/apps.manifest.update
        const response = await axios.post(
            'https://slack.com/api/apps.manifest.update',
            {
                manifest: {
                    // Minimal manifest with interactivity config
                    // Slack will merge this with existing manifest
                    settings: {
                        interactivity: {
                            is_enabled: true,
                            request_url: requestUrl,
                        },
                    },
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${appToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        // Check Slack API response
        if (response.data.ok) {
            logger.info({ requestUrl }, 'Slack Request URL updated successfully');
            return true;
        } else {
            logger.warn(
                { error: response.data.error, requestUrl },
                'Slack API returned error'
            );
            return false;
        }
    } catch (error) {
        logger.error(
            { err: error, requestUrl },
            'Failed to update Slack Request URL'
        );
        return false;
    }
}
