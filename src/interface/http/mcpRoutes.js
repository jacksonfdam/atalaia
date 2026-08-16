import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireMcpKey } from '../../middleware/auth.js';
import { createMcpServer } from '../mcp/server.js';
import logger from '../../infrastructure/logger.js';

/**
 * The MCP endpoint, over Streamable HTTP.
 *
 * Stateless on purpose: one server and one transport per request, no session to
 * keep. Nothing an agent asks for here spans two calls, and holding sessions in
 * memory would mean a restart drops live clients and a second API container
 * cannot answer for the first.
 *
 * Authentication is MCP_API_KEY when one is configured, and the REST API key
 * otherwise. Giving agents their own is the point: the REST key can rewrite
 * where alerts go and which model reads the CVE text, and nothing an agent does
 * here needs that. Clients that can only send an Authorization header get to use
 * `Bearer <key>` instead, which is the same secret by another name.
 */

function acceptBearerKey(req, _res, next) {
    const authorization = req.headers.authorization;
    if (!req.headers['x-api-key'] && authorization?.startsWith('Bearer ')) {
        req.headers['x-api-key'] = authorization.slice('Bearer '.length).trim();
    }
    next();
}

function methodNotAllowed(_req, res) {
    res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'This MCP endpoint is stateless: use POST' },
        id: null,
    });
}

/**
 * @param {object} cache postgresCache module
 * @returns {express.Router}
 */
export function createMcpRoutes(cache) {
    const router = express.Router();

    router.use(acceptBearerKey, requireMcpKey);

    router.post('/', async (req, res) => {
        const server = createMcpServer(cache);
        // JSON responses rather than an SSE stream: every tool here answers
        // once, from the database, and nothing streams progress back.
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });

        // Both are per-request, so both are closed when the request ends —
        // otherwise every call leaks a server and its transport.
        res.on('close', () => {
            transport.close().catch(err => logger.debug({ err }, 'MCP transport close failed'));
            server.close().catch(err => logger.debug({ err }, 'MCP server close failed'));
        });

        try {
            await server.connect(transport);
            // The body is already parsed by express.json(), so it is handed over
            // rather than read from the stream a second time.
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            logger.error({ err: error }, 'MCP request failed');
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: 'Internal server error' },
                    id: null,
                });
            }
        }
    });

    // No server-initiated stream and no session to end.
    router.get('/', methodNotAllowed);
    router.delete('/', methodNotAllowed);

    return router;
}
