/**
 * Explain a failed webhook POST in terms the operator can act on.
 *
 * Slack and Teams both answer a bad webhook with a short plain-text reason in
 * the response body — `no_team`, `no_service`, `invalid_payload`. Axios throws
 * "Request failed with status code 404" and drops that body, which is the
 * difference between an error someone can fix and one they can only stare at.
 */

/** The reasons an operator actually hits, and what each one means. */
const REASONS = {
    no_team: 'this URL is not a webhook in any Slack workspace; check it was copied whole',
    no_service: 'the webhook no longer exists; it was deleted or revoked',
    invalid_token: 'the webhook token is not valid',
    invalid_payload: 'the message body was rejected',
    channel_is_archived: 'the channel the webhook posts to is archived',
    action_prohibited: 'the workspace has blocked posting through this webhook',
};

/**
 * @param {unknown} err An axios error, or anything else thrown while sending
 * @returns {string} A single line: the HTTP status, the service's own reason, and what it means
 */
export function describeWebhookFailure(err) {
    const status = err?.response?.status;

    // No response at all: a timeout, a DNS failure, a refused connection. The
    // axios message is already the whole story.
    if (!status) return err?.message ?? 'the request failed';

    const body = err.response.data;
    const reason = typeof body === 'string' ? body.trim().split('\n')[0].slice(0, 200) : null;
    if (!reason) return `HTTP ${status}`;

    const meaning = REASONS[reason];
    return meaning ? `HTTP ${status} (${reason}): ${meaning}` : `HTTP ${status} (${reason})`;
}
