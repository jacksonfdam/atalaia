import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * pino throws on a level it does not know, which turns a typo in LOG_LEVEL into
 * a container that will not boot — and the message ("default level:verbose must
 * be included in custom levels") does not obviously point at the environment.
 * An unusable level is worth a warning and the default, not an outage.
 */
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

function resolveLevel() {
    const requested = process.env.LOG_LEVEL;
    if (!requested) return 'info';
    if (LEVELS.includes(requested)) return requested;

    // console, not the logger: it does not exist yet.
    console.warn(
        `LOG_LEVEL="${requested}" is not a pino level (${LEVELS.join(', ')}). Falling back to info.`
    );
    return 'info';
}

const MASK = '[redacted]';

/**
 * Field names that are a secret wherever they turn up.
 *
 * `webhookUrl` is here because a Slack or Teams webhook URL *is* the
 * credential — anyone holding it can post as the app.
 */
const SECRET_KEYS = new Set([
    'token',
    'tokens',
    'apikey',
    'api_key',
    'apitoken',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'bottoken',
    'bot_token',
    'apptoken',
    'app_token',
    'password',
    'pass',
    'secret',
    'signingsecret',
    'signing_secret',
    'authorization',
    'auth',
    'cookie',
    'x-api-key',
    'x-session-token',
    'sessiontoken',
    'webhookurl',
    'webhook_url',
    'credentials',
    'key',
]);

/** A path segment that is almost certainly a credential rather than a resource. */
const TOKEN_SHAPED = /^(?:bot\d+:|gh[pousr]_|xox[baprs]-|sk-|glpat-)/i;

/**
 * Strip a URL down to what is worth logging.
 *
 * Three ways a URL carries a secret, and all three happen here: Telegram puts
 * the bot token in the path, several feeds take an API key in the query string,
 * and a webhook URL is itself the credential. What survives is the origin and a
 * path with the token-shaped segments masked — enough to tell which call failed,
 * not enough to make it again.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeUrl(value) {
    if (typeof value !== 'string' || value.length === 0) return MASK;

    let url;
    try {
        url = new URL(value);
    } catch {
        // Not a URL. It may still be a path with a token in it.
        return value.split('/').map(part => (TOKEN_SHAPED.test(part) ? MASK : part)).join('/');
    }

    const path = url.pathname
        .split('/')
        .map(segment => (TOKEN_SHAPED.test(segment) ? MASK : segment))
        .join('/');

    // The query string goes wholesale: naming the parameters that carry keys
    // would be a list to keep up to date, and a query string is rarely the
    // detail that explains a failure.
    const query = url.search ? '?…' : '';

    return `${url.protocol}//${url.host}${path}${query}`;
}

function maskDeep(value, depth = 0) {
    if (depth > 4 || value === null || typeof value !== 'object') return value;

    if (Array.isArray(value)) return value.map(entry => maskDeep(entry, depth + 1));

    const out = {};
    for (const [key, entry] of Object.entries(value)) {
        if (SECRET_KEYS.has(key.toLowerCase())) {
            out[key] = MASK;
        } else if (/url$/i.test(key) && typeof entry === 'string') {
            out[key] = sanitizeUrl(entry);
        } else {
            out[key] = maskDeep(entry, depth + 1);
        }
    }
    return out;
}

/**
 * What an axios failure is allowed to say.
 *
 * pino's standard error serializer copies every own enumerable property of the
 * error, and an axios error owns `config`, `request` and `response`. That is the
 * request headers including Authorization, the raw header block, the full URL —
 * with, for Telegram, the bot token inside it — and the response body. One
 * `logger.error({ err })` on a failed call was writing the credential to disk.
 *
 * So the three of them are replaced with a summary: which call, how it ended.
 */
export function serializeError(err) {
    const serialized = pino.stdSerializers.err(err);
    if (!serialized || typeof serialized !== 'object') return serialized;

    const { config, request, response, ...rest } = serialized;

    const summary = { ...maskDeep(rest, 1) };

    if (config || response) {
        summary.request = {
            method: config?.method?.toUpperCase?.() ?? undefined,
            url: config?.url ? sanitizeUrl(config.url) : undefined,
            status: response?.status ?? err?.response?.status ?? undefined,
            statusText: response?.statusText ?? undefined,
        };
    }

    // An error wrapping another error hides the same payload one level down.
    if (serialized.cause && typeof serialized.cause === 'object') {
        summary.cause = serializeError(serialized.cause);
    }

    return summary;
}

/**
 * A backstop for anything that reaches the log by another route than an error:
 * a config object logged directly, a header bag, a nested credential.
 */
export const REDACT_PATHS = [
    'token',
    'apiKey',
    'api_key',
    'botToken',
    'password',
    'secret',
    'signingSecret',
    'authorization',
    'headers.authorization',
    'headers["x-api-key"]',
    'headers["x-session-token"]',
    '*.token',
    '*.apiKey',
    '*.botToken',
    '*.password',
    '*.secret',
    '*.authorization',
];

/** The serializers and redaction, so a test can build an identical logger. */
export const LOG_SAFETY = {
    serializers: { err: serializeError, error: serializeError },
    redact: { paths: REDACT_PATHS, censor: MASK },
};

const logger = pino({
    level: resolveLevel(),
    ...LOG_SAFETY,
    ...(isProduction
        ? {}
        : {
              transport: {
                  target: 'pino-pretty',
                  options: {
                      colorize: true,
                      translateTime: 'SYS:standard',
                  },
              },
          }),
});

export default logger;
