import ngrok from '@ngrok/ngrok';
import logger from '../logger.js';

/**
 * ngrok.
 *
 * Needs an account: the agent refuses to start without an authtoken, which is
 * why `isConfigured()` is about the token and not about the binary. In return
 * the URL is stable for a paid domain and the dashboard shows every request,
 * which is what makes it worth keeping for Slack.
 */

export const name = 'ngrok';
export const label = 'ngrok';
export const requiresToken = true;
export const envVars = ['NGROK_AUTH_TOKEN', 'NGROK_REGION'];

export function isConfigured() {
    return Boolean(process.env.NGROK_AUTH_TOKEN || process.env.NGROK_AUTHTOKEN);
}

export function reasonUnconfigured() {
    return 'NGROK_AUTH_TOKEN is not set';
}

/**
 * @param {number} port
 * @returns {Promise<{ url: string, stop: () => Promise<void> }>}
 */
export async function start(port) {
    // Any tunnel left over from a previous run holds the port's session, so it
    // goes first — a restart otherwise fails on the agent's own leftovers.
    try {
        await ngrok.disconnect();
    } catch {
        // Nothing to disconnect.
    }

    const region = process.env.NGROK_REGION || 'auto';

    const listener = await ngrok.forward({
        addr: port,
        ...(process.env.NGROK_AUTH_TOKEN
            ? { authtoken: process.env.NGROK_AUTH_TOKEN }
            : { authtoken_from_env: true }),
        // 'auto' is this project's "no preference"; ngrok has no such region.
        ...(region && region !== 'auto' ? { region } : {}),
    });

    return {
        url: listener.url(),
        stop: async () => {
            try {
                await ngrok.disconnect();
            } catch (err) {
                logger.warn({ err }, 'Error closing the ngrok tunnel');
            }
        },
    };
}
