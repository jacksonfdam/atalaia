import { describe, expect, test } from '@jest/globals';
import { describeWebhookFailure } from '../../../src/infrastructure/notifiers/webhookError.js';

/**
 * The point of this helper is that an operator can act on what it says. A
 * message that only carries "status code 404" fails that, which is what these
 * cases pin down.
 */
describe('describeWebhookFailure', () => {
    const axiosError = (status, data) => ({
        message: `Request failed with status code ${status}`,
        response: { status, data },
    });

    test('lifts Slack\'s own reason out of the response body', () => {
        const described = describeWebhookFailure(axiosError(404, 'no_team'));

        expect(described).toContain('404');
        expect(described).toContain('no_team');
        // And what it means, because the reason alone is jargon.
        expect(described).toMatch(/Slack workspace/);
    });

    test('explains a revoked webhook', () => {
        expect(describeWebhookFailure(axiosError(404, 'no_service'))).toMatch(/no longer exists/);
    });

    test('keeps an unknown reason rather than dropping it', () => {
        const described = describeWebhookFailure(axiosError(400, 'something_new'));

        expect(described).toContain('400');
        expect(described).toContain('something_new');
    });

    test('reports the status when there is no body to explain it', () => {
        expect(describeWebhookFailure(axiosError(500, ''))).toBe('HTTP 500');
    });

    test('falls back to the transport error when no response arrived', () => {
        expect(describeWebhookFailure({ message: 'timeout of 10000ms exceeded' })).toBe(
            'timeout of 10000ms exceeded'
        );
    });

    test('survives being handed something that is not an error', () => {
        expect(describeWebhookFailure(undefined)).toBe('the request failed');
    });

    test('trims a multi-line HTML body to its first line', () => {
        const described = describeWebhookFailure(axiosError(403, 'action_prohibited\n<html>…</html>'));

        expect(described).toContain('action_prohibited');
        expect(described).not.toContain('<html>');
    });
});
