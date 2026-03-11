import ngrok from 'ngrok';
import logger from './logger.js';

/**
 * Start an ngrok tunnel to expose the local server.
 * @param {number} port - The local port to expose (default: 3000)
 * @param {string} authToken - Optional ngrok auth token from env
 * @param {string} region - Optional ngrok region (default: 'auto')
 * @returns {Promise<string|null>} - Public URL (e.g., https://abc123.ngrok.io) or null on failure
 */
export async function startNgrokTunnel(port = 3000, authToken, region = 'auto') {
    try {
        // Set auth token if provided
        if (authToken) {
            logger.info('Setting ngrok auth token');
            await ngrok.authtoken(authToken);
        }

        // Disconnect any existing tunnels first to avoid conflicts
        try {
            await ngrok.disconnect();
        } catch (e) {
            // Ignore if no tunnels to disconnect
        }

        logger.info({ port, region }, 'Starting ngrok tunnel');

        // Start the tunnel
        const url = await ngrok.connect({
            addr: port,
            region,
        });

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
