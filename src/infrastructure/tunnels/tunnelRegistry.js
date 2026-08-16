import * as ngrokTunnel from './ngrokTunnel.js';
import * as cloudflaredTunnel from './cloudflaredTunnel.js';
import logger from '../logger.js';

/**
 * Public URLs for a service nobody can reach.
 *
 * Slack and Telegram both call back — a button pressed in a chat has to arrive
 * somewhere — and in development there is no address to give them. A tunnel
 * borrows one.
 *
 * One file per provider, all of them listed here: the same shape as feeds and
 * parsers, so adding a third is a file plus a line rather than another branch
 * in an if.
 *
 * Order matters only for `auto`, which takes the first provider that is
 * configured: ngrok when it has a token, Cloudflare otherwise, since a quick
 * tunnel needs nothing at all.
 */
export const tunnels = [ngrokTunnel, cloudflaredTunnel];

export const PROVIDER_NAMES = tunnels.map(provider => provider.name);

/** What the console and `doctor` show without starting anything. */
export function describeTunnels() {
    return tunnels.map(provider => ({
        name: provider.name,
        label: provider.label,
        requiresToken: provider.requiresToken,
        envVars: provider.envVars,
        configured: provider.isConfigured(),
        reason: provider.isConfigured() ? null : provider.reasonUnconfigured(),
    }));
}

/**
 * Which provider to use, from TUNNEL_PROVIDER.
 *
 * `none` is a real answer, not a failure: a production install has a real
 * hostname and wants no tunnel at all.
 *
 * @returns {{ provider: object|null, reason?: string }}
 */
export function resolveTunnelProvider() {
    const requested = (process.env.TUNNEL_PROVIDER || 'auto').toLowerCase();

    if (requested === 'none' || requested === 'off' || requested === 'false') {
        return { provider: null, reason: 'TUNNEL_PROVIDER=none' };
    }

    if (requested !== 'auto') {
        const provider = tunnels.find(candidate => candidate.name === requested);
        if (!provider) {
            return {
                provider: null,
                reason: `Unknown TUNNEL_PROVIDER "${requested}" — known providers: ${PROVIDER_NAMES.join(', ')}`,
            };
        }
        // Named explicitly, so it is used even unconfigured: the start attempt
        // fails with the provider's own message, which says more than a guess.
        return { provider };
    }

    const provider = tunnels.find(candidate => candidate.isConfigured());
    return provider
        ? { provider }
        : { provider: null, reason: 'No tunnel provider is configured' };
}

/**
 * Open a tunnel to a local port.
 *
 * Never throws: a tunnel is a convenience, and an API that refuses to start
 * because a development-only helper failed is worse than one with no callbacks.
 *
 * @param {number} port
 * @returns {Promise<{ url: string, provider: string, stop: () => Promise<void> }|null>}
 */
export async function startTunnel(port) {
    const { provider, reason } = resolveTunnelProvider();

    if (!provider) {
        logger.info({ reason }, 'No tunnel started');
        return null;
    }

    try {
        logger.info({ provider: provider.name, port }, 'Starting tunnel');
        const { url, stop } = await provider.start(port);
        logger.info({ provider: provider.name, url }, 'Tunnel established');

        return { url, provider: provider.name, stop };
    } catch (err) {
        logger.warn(
            { err, provider: provider.name, port },
            'Failed to start the tunnel — continuing without a public URL'
        );
        return null;
    }
}
