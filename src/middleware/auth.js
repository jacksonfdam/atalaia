import crypto from 'node:crypto';
import logger from '../infrastructure/logger.js';

/**
 * The machine credential.
 *
 * It says which *program* is calling — the console's server, the CLI, an agent —
 * not which person. Who the person is comes from the session token, checked
 * separately in middleware/session.js.
 *
 * Two keys rather than one. `API_KEY` opens the REST API, which can rewrite
 * every integration in the product: where alerts go, which model sees the CVE
 * text, which GitHub organizations are imported. `MCP_API_KEY` opens only /mcp,
 * where every tool reads. An agent is given the second one, so a prompt that
 * talks it into calling something destructive has nothing to call.
 *
 * With MCP_API_KEY unset, /mcp falls back to API_KEY and an agent holds the
 * keys to the kingdom. That is the old behaviour, kept so an upgrade does not
 * silently disconnect a working agent, and it is worth changing.
 */

/**
 * Compare a presented secret against the expected one without leaking its
 * length or its prefix through timing.
 *
 * Both sides are hashed first: timingSafeEqual throws on a length mismatch, and
 * catching that would itself be the length oracle.
 */
export function secretMatches(presented, expected) {
    if (typeof presented !== 'string' || typeof expected !== 'string') return false;
    if (presented.length === 0 || expected.length === 0) return false;

    const a = crypto.createHash('sha256').update(presented).digest();
    const b = crypto.createHash('sha256').update(expected).digest();

    return crypto.timingSafeEqual(a, b);
}

function presentedKey(req) {
    const header = req.headers['x-api-key'];
    return typeof header === 'string' ? header : null;
}

/**
 * Express middleware requiring a valid API key in the X-API-Key header.
 */
export function requireApiKey(req, res, next) {
    const validKey = process.env.API_KEY;

    if (!validKey) {
        logger.error('API_KEY environment variable not set');
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    if (!secretMatches(presentedKey(req), validKey)) {
        logger.warn({ path: req.path, ip: req.ip }, 'Unauthorized API request');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
}

/** Whether agents have been given a key of their own. */
export function hasDedicatedMcpKey() {
    return Boolean(process.env.MCP_API_KEY);
}

/**
 * Express middleware for /mcp: the agent key if one is configured, the API key
 * otherwise. Deliberately not both — a dedicated key that the REST API also
 * accepted would separate nothing.
 */
export function requireMcpKey(req, res, next) {
    const dedicated = process.env.MCP_API_KEY;

    if (dedicated) {
        if (!secretMatches(presentedKey(req), dedicated)) {
            logger.warn({ ip: req.ip }, 'Unauthorized MCP request');
            return res.status(401).json({ error: 'Unauthorized' });
        }
        return next();
    }

    return requireApiKey(req, res, next);
}
