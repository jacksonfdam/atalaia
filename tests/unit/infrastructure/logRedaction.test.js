/**
 * What the log is allowed to say.
 *
 * This suite exists because of a real leak: pino's standard error serializer
 * copies every own property of an error, and an axios error owns the request
 * config — headers, and a URL with the Telegram bot token inside it. A single
 * `logger.error({ err })` on a failed outbound call wrote the credential to
 * disk, and there are two dozen of those call sites.
 *
 * The failing input is reconstructed here rather than described, so this stays
 * a test of the serializer rather than a note about it.
 */
import { test, expect, describe } from '@jest/globals';
import { Writable } from 'node:stream';
import pino from 'pino';
import { sanitizeUrl, LOG_SAFETY } from '#app/infrastructure/logger.js';

/**
 * The production logger, writing somewhere this test can read.
 *
 * Built from the exported configuration rather than a copy of it, so a path
 * dropped from the real logger fails here too.
 */
function captured(fn) {
    const lines = [];
    const stream = new Writable({
        write(chunk, _encoding, next) {
            lines.push(chunk.toString());
            next();
        },
    });

    fn(pino({ level: 'info', ...LOG_SAFETY }, stream));
    return lines.join('\n');
}

/** An axios error, in the shape axios actually produces one. */
function axiosFailure() {
    const error = new Error('Request failed with status code 401');
    error.name = 'AxiosError';
    error.code = 'ERR_BAD_REQUEST';
    error.config = {
        method: 'post',
        url: 'https://api.telegram.org/bot123456789:AA-REAL-BOT-TOKEN/sendMessage',
        headers: { Authorization: 'Bearer ghp_REAL_GITHUB_TOKEN', 'X-Api-Key': 'REAL-API-KEY' },
        data: '{"chat_id":1}',
    };
    error.request = {
        _header:
            'POST /bot123456789:AA-REAL-BOT-TOKEN/sendMessage HTTP/1.1\r\n' +
            'Authorization: Bearer ghp_REAL_GITHUB_TOKEN\r\n',
    };
    error.response = {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'set-cookie': 'session=REAL-SESSION' },
        data: { description: 'Unauthorized' },
        config: error.config,
    };
    return error;
}

const SECRETS = [
    'AA-REAL-BOT-TOKEN',
    'ghp_REAL_GITHUB_TOKEN',
    'REAL-API-KEY',
    'REAL-SESSION',
];

describe('an axios failure', () => {
    test('names the call without repeating the credentials in it', () => {
        const line = captured(log => log.error({ err: axiosFailure() }, 'Telegram call failed'));

        for (const secret of SECRETS) {
            expect(line).not.toContain(secret);
        }
    });

    test('still says what failed and how', () => {
        const line = captured(log => log.error({ err: axiosFailure() }, 'Telegram call failed'));
        const entry = JSON.parse(line);

        expect(entry.msg).toBe('Telegram call failed');
        expect(entry.err.message).toBe('Request failed with status code 401');
        expect(entry.err.request.status).toBe(401);
        expect(entry.err.request.method).toBe('POST');
        expect(entry.err.request.url).toContain('api.telegram.org');
    });

    test('does not hide the credential one level down, in a wrapped error', () => {
        const wrapper = new Error('Could not deliver the alert');
        wrapper.cause = axiosFailure();

        const line = captured(log => log.error({ err: wrapper }, 'Delivery failed'));

        for (const secret of SECRETS) {
            expect(line).not.toContain(secret);
        }
    });
});

describe('fields that are a secret wherever they appear', () => {
    test('are censored even when logged deliberately', () => {
        const line = captured(log =>
            log.info(
                {
                    config: {
                        botToken: 'AA-REAL-BOT-TOKEN',
                        apiKey: 'REAL-API-KEY',
                        webhookUrl: 'https://hooks.slack.com/services/T/B/REAL-WEBHOOK',
                    },
                },
                'Configuration loaded'
            )
        );

        expect(line).not.toContain('AA-REAL-BOT-TOKEN');
        expect(line).not.toContain('REAL-API-KEY');
    });
});

describe('sanitizeUrl', () => {
    test('masks the bot token Telegram puts in the path', () => {
        expect(sanitizeUrl('https://api.telegram.org/bot123456:AA-SECRET/sendMessage')).toBe(
            'https://api.telegram.org/[redacted]/sendMessage'
        );
    });

    test('drops the query string, where feeds carry their keys', () => {
        expect(sanitizeUrl('https://services.nvd.nist.gov/rest/json/cves?apiKey=SECRET&x=1')).toBe(
            'https://services.nvd.nist.gov/rest/json/cves?…'
        );
    });

    test('keeps an ordinary URL readable', () => {
        expect(sanitizeUrl('https://api.github.com/repos/acme/widgets')).toBe(
            'https://api.github.com/repos/acme/widgets'
        );
    });

    test('masks a token-shaped segment in something that is not a URL', () => {
        expect(sanitizeUrl('/bot987:AA-SECRET/getMe')).toBe('/[redacted]/getMe');
    });

    test('says nothing at all about a value it cannot parse', () => {
        expect(sanitizeUrl(undefined)).toBe('[redacted]');
    });
});
