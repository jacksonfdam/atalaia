import crypto from 'crypto';
import logger from '../../infrastructure/logger.js';
import { acknowledgeVuln } from '../../application/acknowledgeVuln.js';
import { resolveVuln } from '../../application/resolveVuln.js';
import { resolveSigningSecret } from '../../infrastructure/notifiers/slackConfig.js';

/**
 * Validate Slack request signature to prevent replay attacks.
 * @param {string} signingSecret - SLACK_SIGNING_SECRET env var
 * @param {string} timestamp - x-slack-request-timestamp header
 * @param {string} rawBody - Raw request body string
 * @param {string} signature - x-slack-signature header
 * @returns {boolean}
 */
export function validateSlackSignature(signingSecret, timestamp, rawBody, signature) {
    if (!signingSecret || !timestamp || !signature || rawBody === undefined) return false;

    // Reject requests older than 5 minutes (replay attack prevention)
    const currentTime = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTime - parseInt(timestamp, 10)) > 300) {
        return false;
    }

    const baseString = `v0:${timestamp}:${rawBody}`;
    const computed = `v0=${crypto
        .createHmac('sha256', signingSecret)
        .update(baseString)
        .digest('hex')}`;

    if (computed.length !== signature.length) return false;

    return crypto.timingSafeEqual(
        Buffer.from(computed),
        Buffer.from(signature)
    );
}

/**
 * Express middleware to validate Slack signing secret.
 */
export function requireSlackSignature(req, res, next) {
    // Environment first, then whatever the console stored.
    const signingSecret = resolveSigningSecret();
    if (!signingSecret) {
        logger.error('No Slack signing secret configured; rejecting the callback');
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    const timestamp = req.headers['x-slack-request-timestamp'];
    const signature = req.headers['x-slack-signature'];
    const rawBody = req.rawBody;

    if (!validateSlackSignature(signingSecret, timestamp, rawBody, signature)) {
        logger.warn({ ip: req.ip }, 'Invalid Slack signature');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
}

/**
 * Handle Slack interactive message actions (button clicks).
 * @param {{ get: Function, update: Function }} cache
 */
export function createSlackActionHandler(cache) {
    return async (req, res) => {
        let payload;
        try {
            payload = JSON.parse(req.body.payload);
        } catch {
            return res.status(400).json({ error: 'Invalid payload' });
        }

        const { user, actions } = payload;
        const action = actions?.[0];
        if (!action) {
            return res.status(400).json({ error: 'No action found' });
        }

        const cveId = action.value;
        const userId = user?.id || 'unknown';
        const changedBy = `slack:${userId}`;

        try {
            let vuln;
            if (action.action_id === 'ack_vuln') {
                vuln = await acknowledgeVuln(cveId, changedBy, cache);
                logger.info({ cveId, userId, action: 'acknowledge' }, 'Vulnerability acknowledged via Slack');
            } else if (action.action_id === 'resolve_vuln') {
                vuln = await resolveVuln(cveId, changedBy, cache);
                logger.info({ cveId, userId, action: 'resolve' }, 'Vulnerability resolved via Slack');
            } else {
                return res.status(400).json({ text: `Unknown action: ${action.action_id}` });
            }

            res.json({
                response_type: 'in_channel',
                replace_original: false,
                text: `Status updated to ${vuln.status} by <@${userId}>`,
            });
        } catch (error) {
            logger.error({ cveId, userId, err: error }, 'Slack action failed');
            res.json({ text: `Error: ${error.message}` });
        }
    };
}
