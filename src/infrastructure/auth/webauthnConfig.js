/**
 * What the browser must be, for a passkey to be accepted.
 *
 * WebAuthn binds every credential to a relying party id — a domain. The
 * browser refuses a ceremony whose rpID is not the origin's host or a parent of
 * it, and a credential registered under one rpID cannot be used under another.
 * That makes these four values load-bearing in a way most configuration is not:
 * getting them wrong does not degrade the login, it deletes it.
 *
 * So they are validated at boot and the process refuses to start on a value
 * that would only fail later, in a browser, with an error nobody can read.
 *
 * Note whose origin this is. The passkey ceremony happens in the console, on
 * port 3001; the API only verifies it. WEBAUTHN_ORIGINS is therefore the
 * console's address, not this service's.
 */

const DEFAULT_RP_ID = 'localhost';
const DEFAULT_ORIGINS = 'http://localhost:3001';
const DEFAULT_SESSION_TTL_HOURS = 720;
const DEFAULT_CHALLENGE_TTL_SECONDS = 120;

/** Hostnames the specification lets us serve over plain http. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** A domain name: labels of letters, digits and hyphens, separated by dots. */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

class ConfigError extends Error {}

function positiveNumber(name, raw, fallback) {
    if (raw === undefined || raw === '') return fallback;

    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new ConfigError(`${name} must be a positive number, got "${raw}"`);
    }
    return value;
}

function readRpId() {
    const raw = (process.env.WEBAUTHN_RP_ID || DEFAULT_RP_ID).trim().toLowerCase();

    if (raw.includes('://') || raw.includes('/') || raw.includes(':')) {
        throw new ConfigError(
            `WEBAUTHN_RP_ID is a bare domain — no scheme, no port, no path. Got "${raw}".`
        );
    }
    if (!HOSTNAME.test(raw)) {
        throw new ConfigError(`WEBAUTHN_RP_ID is not a domain name: "${raw}"`);
    }

    return raw;
}

function readOrigins(rpID) {
    const raw = process.env.WEBAUTHN_ORIGINS || DEFAULT_ORIGINS;
    const parts = raw.split(',').map(part => part.trim()).filter(Boolean);

    if (parts.length === 0) {
        throw new ConfigError('WEBAUTHN_ORIGINS is empty');
    }

    return parts.map(part => {
        let url;
        try {
            url = new URL(part);
        } catch {
            throw new ConfigError(`WEBAUTHN_ORIGINS entry is not a URL: "${part}"`);
        }

        if (url.pathname !== '/' || url.search || url.hash) {
            throw new ConfigError(
                `WEBAUTHN_ORIGINS entry carries a path — an origin is scheme, host and port only: "${part}"`
            );
        }

        const host = url.hostname.toLowerCase();

        if (url.protocol !== 'https:' && !LOOPBACK.has(host)) {
            throw new ConfigError(
                `WEBAUTHN_ORIGINS entry must be https outside loopback: "${part}"`
            );
        }

        // The browser enforces this too, but it enforces it at the moment a
        // human is trying to sign in. Better to fail at boot.
        if (host !== rpID && !host.endsWith(`.${rpID}`)) {
            throw new ConfigError(
                `WEBAUTHN_ORIGINS entry "${part}" is not under WEBAUTHN_RP_ID "${rpID}" — ` +
                    'the browser will reject every ceremony.'
            );
        }

        return url.origin;
    });
}

/**
 * Read and validate the WebAuthn configuration.
 *
 * Read on each call rather than frozen at import, because the tests set these
 * per case and anything captured at import time would pin the whole suite to
 * whichever one ran first.
 *
 * @throws {Error} on any value the browser would later reject
 * @returns {{rpID: string, rpName: string, origins: string[], sessionTtlHours: number,
 *            challengeTtlSeconds: number, requireUserVerification: boolean}}
 */
export function webauthnConfig() {
    const rpID = readRpId();

    return {
        rpID,
        rpName: process.env.WEBAUTHN_RP_NAME || 'Atalaia Console',
        origins: readOrigins(rpID),
        sessionTtlHours: positiveNumber(
            'SESSION_TTL_HOURS',
            process.env.SESSION_TTL_HOURS,
            DEFAULT_SESSION_TTL_HOURS
        ),
        challengeTtlSeconds: positiveNumber(
            'CHALLENGE_TTL_SECONDS',
            process.env.CHALLENGE_TTL_SECONDS,
            DEFAULT_CHALLENGE_TTL_SECONDS
        ),
        // Off by default: a security key without a PIN is still a far better
        // credential than the shared password it replaces, and requiring user
        // verification locks out authenticators that cannot do it.
        requireUserVerification: process.env.WEBAUTHN_REQUIRE_UV === 'true',
    };
}

/**
 * Whether the configuration is usable, without throwing.
 * @returns {{ok: true, config: object} | {ok: false, error: string}}
 */
export function checkWebauthnConfig() {
    try {
        return { ok: true, config: webauthnConfig() };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}
