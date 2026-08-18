/**
 * The short version of a vulnerability.
 *
 * Two different things land in this slot: a paragraph a model wrote, and the
 * advisory's own words when no model is configured. One definition here, every
 * channel reading it, so the fallback cannot drift apart between them the way
 * it already had once.
 *
 * `generated` says which of the two it is. Nothing renders it today — the
 * heading each channel used to carry was dropped deliberately — but the answer
 * is kept rather than thrown away, because the question is a real one and the
 * caller that wants it should not have to work it out again from the row.
 */

/**
 * @param {object} vuln              Entity or row; both spellings of the column are read
 * @param {number} [fallbackLimit]   Cap applied to the advisory text only, never to the model's
 * @returns {{ text: string, generated: boolean } | null} null when there is neither
 */
export function shortVersion(vuln, fallbackLimit = Infinity) {
    const generated = vuln.clientExplanation ?? vuln.client_explanation;
    if (generated) return { text: generated, generated: true };

    const description = vuln.description ?? '';
    if (!description) return null;

    const text = description.length > fallbackLimit
        ? `${description.slice(0, fallbackLimit - 1)}…`
        : description;

    return { text, generated: false };
}
