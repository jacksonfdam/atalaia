/**
 * The short version of a vulnerability, and where it came from.
 *
 * Two different things land in this slot: a paragraph a model wrote, and the
 * advisory's own words when no model is configured. They used to arrive under
 * the same heading in every channel, so a reader could not tell which one they
 * had — and a generated paragraph passing as source text is the one thing this
 * slot must never be allowed to do.
 *
 * One definition here, every channel reading it, so the labelling cannot drift
 * apart the way the fallback itself already had.
 */

export const MODEL_SOURCE = 'written by a model';
export const ADVISORY_SOURCE = 'from the advisory';

/**
 * @param {object} vuln              Entity or row; both spellings of the column are read
 * @param {number} [fallbackLimit]   Cap applied to the advisory text only, never to the model's
 * @returns {{ text: string, source: string, generated: boolean } | null} null when there is neither
 */
export function shortVersion(vuln, fallbackLimit = Infinity) {
    const generated = vuln.clientExplanation ?? vuln.client_explanation;
    if (generated) return { text: generated, source: MODEL_SOURCE, generated: true };

    const description = vuln.description ?? '';
    if (!description) return null;

    const text = description.length > fallbackLimit
        ? `${description.slice(0, fallbackLimit - 1)}…`
        : description;

    return { text, source: ADVISORY_SOURCE, generated: false };
}
