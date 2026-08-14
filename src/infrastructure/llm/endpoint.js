import logger from '../logger.js';

/**
 * Getting to a model endpoint from wherever this process happens to be running.
 *
 * Two things bite here, and neither is the operator's fault.
 *
 * **The path.** Every hosted provider wants a URL ending in
 * `/v1/chat/completions`, so that is what people paste. Ollama's own API is
 * `/api/generate` off the base, and appending one to the other gives
 * `/v1/chat/api/generate` — a 404 that surfaced as "the model returned nothing".
 *
 * **The host.** `localhost:11434` is where Ollama runs on a laptop. Inside a
 * container that address is the container itself, so the connection is refused.
 * Atalaia runs in containers now, which turned a working configuration into a
 * broken one without anybody changing it.
 */

/** Paths people paste that are not part of a base URL. */
const PASTED_SUFFIXES = [
    '/v1/chat/completions',
    '/v1/chat/completion',
    '/v1/chat',
    '/api/generate',
    '/api/chat',
    '/v1',
];

/**
 * The base URL, whatever was pasted.
 *
 * @param {string} url
 * @returns {string}
 */
export function normalizeBaseUrl(url) {
    let base = String(url ?? '').trim().replace(/\/+$/, '');

    for (const suffix of PASTED_SUFFIXES) {
        if (base.toLowerCase().endsWith(suffix)) {
            base = base.slice(0, -suffix.length).replace(/\/+$/, '');
            break;
        }
    }

    return base;
}

/** Endpoint paths people paste for a provider that speaks the OpenAI shape. */
const OPENAI_SUFFIXES = ['/chat/completions', '/chat/completion', '/chat', '/completions', '/messages'];

/**
 * The base for a versioned REST API — the part before `/chat/completions` or
 * `/messages`, with the version segment intact.
 *
 * Unlike Ollama, these providers version the path, and not all of them use the
 * same segment: OpenAI is `/v1`, Groq is `/openai/v1`, Gemini is
 * `/v1beta/openai`. So a version already present is kept as it stands, and only
 * a URL that has none gets the `/v1` every one of them would have wanted.
 *
 * @param {string} url
 * @returns {string}
 */
export function normalizeVersionedBaseUrl(url) {
    let base = String(url ?? '').trim().replace(/\/+$/, '');
    if (!base) return base;

    for (const suffix of OPENAI_SUFFIXES) {
        if (base.toLowerCase().endsWith(suffix)) {
            base = base.slice(0, -suffix.length).replace(/\/+$/, '');
            break;
        }
    }

    return hasVersionSegment(base) ? base : `${base}/v1`;
}

function hasVersionSegment(url) {
    try {
        return new URL(url).pathname.split('/').some(segment => /^v\d/i.test(segment));
    } catch {
        return /\/v\d/i.test(url);
    }
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

/** Is this URL pointing at the machine the process is on? */
export function isLoopback(url) {
    try {
        return LOOPBACK.test(new URL(url).hostname);
    } catch {
        return false;
    }
}

/** The same URL with the host a container can actually reach. */
export function viaContainerHost(url) {
    try {
        const parsed = new URL(url);
        parsed.hostname = 'host.docker.internal';
        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return url;
    }
}

/**
 * Run `attempt` against the URL, and once more against the host gateway if the
 * connection was refused to a loopback address.
 *
 * Behaviour rather than environment detection: a refused connection to
 * localhost is the symptom of being in a container, and retrying costs one
 * round trip against a port that is already known not to answer. It works the
 * same whether this is a container, a laptop, or Apple's runtime — none of
 * which advertise themselves the same way.
 *
 * @param {string} baseUrl
 * @param {(url: string) => Promise<T>} attempt
 * @returns {Promise<T>}
 * @template T
 */
export async function withReachableHost(baseUrl, attempt) {
    try {
        return await attempt(baseUrl);
    } catch (error) {
        const refused =
            error?.code === 'ECONNREFUSED' ||
            error?.cause?.code === 'ECONNREFUSED' ||
            /ECONNREFUSED|EHOSTUNREACH/.test(error?.message ?? '');

        if (!refused || !isLoopback(baseUrl)) throw error;

        const fallback = viaContainerHost(baseUrl);
        logger.info(
            { from: baseUrl, to: fallback },
            'Loopback refused; retrying through the container host gateway'
        );

        return attempt(fallback);
    }
}
