/**
 * A cap on how often the same thing can be tried.
 *
 * Scoped to whatever the caller keys it by — an account name, a credential, the
 * bootstrap route as a whole. Not by address: every request the API sees arrives
 * from the console, so an IP here identifies the console rather than the person
 * using it. Per-address limiting is the console's job, where the address is
 * real.
 *
 * In memory, which is honest about what this is. It survives neither a restart
 * nor a second API container, and it is not the thing standing between an
 * attacker and an account — that is a 120-bit code and a signature over a
 * challenge. It exists so that guessing costs time.
 */

/** @type {Map<string, {count: number, first: number}>} */
const buckets = new Map();

/** Bound the map so a flood of distinct keys cannot grow it without limit. */
const MAX_KEYS = 10_000;

function prune(now) {
    for (const [key, bucket] of buckets) {
        if (now - bucket.first > bucket.windowMs) buckets.delete(key);
    }
}

/**
 * @param {string} key
 * @param {object} limit
 * @param {number} limit.max        attempts allowed in the window
 * @param {number} limit.windowMs
 * @returns {{allowed: boolean, retryAfterSeconds: number}}
 */
export function attempt(key, { max, windowMs }) {
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.first > bucket.windowMs) {
        if (buckets.size >= MAX_KEYS) prune(now);
        buckets.set(key, { count: 1, first: now, windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
    }

    bucket.count += 1;

    if (bucket.count > max) {
        return {
            allowed: false,
            retryAfterSeconds: Math.ceil((bucket.windowMs - (now - bucket.first)) / 1000),
        };
    }

    return { allowed: true, retryAfterSeconds: 0 };
}

/** Forget a key, so a success does not leave a half-full bucket behind. */
export function clearAttempts(key) {
    buckets.delete(key);
}

/** Exported for the tests: the buckets are process-wide state shared across cases. */
export function resetRateLimits() {
    buckets.clear();
}

/**
 * Refuse politely, in the shape the console already knows how to render.
 * @param {import('express').Response} res
 * @param {number} retryAfterSeconds
 */
export function tooManyAttempts(res, retryAfterSeconds) {
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({ error: 'Too many attempts', retryAfterSeconds });
}
