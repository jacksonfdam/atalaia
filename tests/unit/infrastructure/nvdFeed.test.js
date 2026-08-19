import { jest } from '@jest/globals';

/**
 * NVD answers 403 or 503 when you go too fast, never 429, and the transport
 * message for that is "Request failed with status code 503" — which reads as
 * an outage at NVD rather than as a limit that a free key lifts.
 */

const get = jest.fn();
jest.unstable_mockModule('axios', () => ({ default: { get } }));

const { fetch } = await import('#app/infrastructure/feeds/nvdFeed.js');

/** The axios config of the request the feed made. */
function sentConfig() {
    return get.mock.calls[0][1];
}

function refusedWith(status) {
    return Object.assign(new Error(`Request failed with status code ${status}`), {
        response: { status },
    });
}

beforeEach(() => {
    get.mockReset();
    delete process.env.NVD_API_KEY;
    get.mockResolvedValue({ data: { vulnerabilities: [] } });
});

describe('the key', () => {
    test('is sent as the apiKey header when it is set', async () => {
        process.env.NVD_API_KEY = 'abc-123';

        await fetch();

        expect(sentConfig().headers.apiKey).toBe('abc-123');
    });

    test('is absent, not empty, when it is not set', async () => {
        await fetch();

        expect(sentConfig().headers).not.toHaveProperty('apiKey');
    });
});

describe('being refused', () => {
    test.each([403, 503])('%i says it is the rate limit, and names the fix', async status => {
        get.mockRejectedValue(refusedWith(status));

        await expect(fetch()).rejects.toThrow(/NVD_API_KEY/);
    });

    test('with a key, the message stops advising one', async () => {
        process.env.NVD_API_KEY = 'abc-123';
        get.mockRejectedValue(refusedWith(503));

        await expect(fetch()).rejects.toThrow(/50 requests per 30 seconds/);
    });

    // Anything else is a real failure and must not be dressed up as a limit.
    test('a 500 keeps its own message', async () => {
        get.mockRejectedValue(refusedWith(500));

        await expect(fetch()).rejects.toThrow('Request failed with status code 500');
    });
});
