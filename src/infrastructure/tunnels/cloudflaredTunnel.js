import fs from 'node:fs';
import { bin, install, Tunnel } from 'cloudflared';
import logger from '../logger.js';

/**
 * Cloudflare's quick tunnel.
 *
 * No account and no token: `cloudflared` hands out a throwaway
 * *.trycloudflare.com hostname for as long as the process lives. That is the
 * whole appeal — a machine with nothing configured can still receive a webhook.
 *
 * The cost is a binary that is not in the npm package: it is downloaded on
 * first use, so the first start is slower and a machine with no outbound
 * network cannot use this provider at all.
 */

export const name = 'cloudflared';
export const label = 'Cloudflare quick tunnel';
export const requiresToken = false;
export const envVars = [];

/** Nothing to configure — which is the point. */
export function isConfigured() {
    return true;
}

export function reasonUnconfigured() {
    return null;
}

/** Resolving the URL can outlast a slow download, but not forever. */
const READY_TIMEOUT_MS = 60_000;

/**
 * @param {number} port
 * @returns {Promise<{ url: string, stop: () => Promise<void> }>}
 */
export async function start(port) {
    if (!fs.existsSync(bin)) {
        logger.info('Downloading the cloudflared binary — first run only');
        await install(bin);
    }

    const connection = Tunnel.quick(`http://localhost:${port}`);

    // The hostname is announced on the process output rather than returned, so
    // it is waited for — and the wait is bounded, because a cloudflared that
    // never connects would otherwise hold the boot open forever.
    const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            connection.stop();
            reject(new Error('cloudflared did not report a URL within 60s'));
        }, READY_TIMEOUT_MS);
        timer.unref();

        connection.once('url', value => {
            clearTimeout(timer);
            resolve(value);
        });

        connection.once('error', err => {
            clearTimeout(timer);
            reject(err);
        });
    });

    return {
        url,
        stop: async () => {
            try {
                connection.stop();
            } catch (err) {
                logger.warn({ err }, 'Error closing the cloudflared tunnel');
            }
        },
    };
}
