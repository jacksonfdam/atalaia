/**
 * Which addresses Telegram will actually call.
 *
 * Telegram's own answer to a bad one is "Failed to resolve host: Name or
 * service not known" — true, and no help at all. These are the cases behind it.
 */
import { test, expect, describe } from '@jest/globals';
import { checkWebhookUrl, webhookPath } from '#app/infrastructure/notifiers/telegramWebhook.js';

describe('the callback path', () => {
    test('is appended to the base URL, trailing slash or not', () => {
        expect(webhookPath('https://atalaia.example.com')).toBe(
            'https://atalaia.example.com/api/v1/telegram/webhook'
        );
        expect(webhookPath('https://atalaia.example.com/')).toBe(
            'https://atalaia.example.com/api/v1/telegram/webhook'
        );
    });
});

describe('addresses Telegram will call', () => {
    test('a public https host', () => {
        expect(checkWebhookUrl('https://atalaia.example.com/api/v1/telegram/webhook').ok).toBe(true);
    });

    test('a quick tunnel', () => {
        expect(checkWebhookUrl('https://wind-sussex.trycloudflare.com/api/v1/telegram/webhook').ok).toBe(
            true
        );
    });

    test('an allowed non-default port', () => {
        expect(checkWebhookUrl('https://atalaia.example.com:8443/x').ok).toBe(true);
    });
});

describe('addresses it will not', () => {
    test('plain http', () => {
        const { ok, reason } = checkWebhookUrl('http://atalaia.example.com/x');
        expect(ok).toBe(false);
        expect(reason).toContain('https');
    });

    test('localhost', () => {
        expect(checkWebhookUrl('https://localhost:3000/x').reason).toContain('only reachable from this machine');
    });

    test('a private address', () => {
        expect(checkWebhookUrl('https://192.168.0.10/x').reason).toContain('only reachable');
        expect(checkWebhookUrl('https://127.0.0.1/x').reason).toContain('only reachable');
    });

    test('a container name, which is what the compose network hands out', () => {
        const { ok, reason } = checkWebhookUrl('https://atalaia/api/v1/telegram/webhook');
        expect(ok).toBe(false);
        expect(reason).toContain('cannot resolve');
    });

    test('a port Telegram refuses', () => {
        const { ok, reason } = checkWebhookUrl('https://atalaia.example.com:3000/x');
        expect(ok).toBe(false);
        expect(reason).toContain('443');
    });

    test('something that is not a URL at all', () => {
        expect(checkWebhookUrl('atalaia.example.com').ok).toBe(false);
    });
});
