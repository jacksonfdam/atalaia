import ngrok from '@ngrok/ngrok';
import logger from './logger.js';

/**
 * Start an ngrok tunnel to expose the local server.
 * @param {number} port - The local port to expose (default: 3000)
 * @param {string} authToken - Optional ngrok auth token from env
 * @param {string} region - Optional ngrok region (default: 'auto' — let ngrok pick)
 * @returns {Promise<string|null>} - Public URL (e.g., https://abc123.ngrok.io) or null on failure
 */
export async function startNgrokTunnel(port = 3000, authToken, region = 'auto') {
    try {
        // Disconnect any existing tunnels first to avoid conflicts
        try {
            await ngrok.disconnect();
        } catch {
            // Ignore if no tunnels to disconnect
        }

        logger.info({ port, region }, 'Starting ngrok tunnel');

        const listener = await ngrok.forward({
            addr: port,
            ...(authToken ? { authtoken: authToken } : { authtoken_from_env: true }),
            // 'auto' is this project's "no preference" value; ngrok has no such region
            ...(region && region !== 'auto' ? { region } : {}),
        });

        const url = listener.url();
        logger.info({ url, port }, 'ngrok tunnel started successfully');
        return url;
    } catch (error) {
        logger.warn(
            { err: error, port, region, code: error?.code },
            'Failed to start ngrok tunnel - proceeding without ngrok'
        );
        return null;
    }
}

/**
 * Close the ngrok tunnel gracefully.
 * @returns {Promise<void>}
 */
export async function stopNgrokTunnel() {
    try {
        await ngrok.disconnect();
        logger.info('ngrok tunnel closed');
    } catch (error) {
        logger.warn({ err: error }, 'Error closing ngrok tunnel');
    }
}
