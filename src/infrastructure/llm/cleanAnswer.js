/**
 * What the model actually said, and whether it said anything.
 *
 * Asked for a paragraph, an assistant-tuned model wraps it in things that are
 * not the paragraph: "Certainly! Here's an explanation for your non-technical
 * audience:", a `---` above the first heading, a code fence around the whole
 * answer, a bold title restating what it was asked for. All of it reaches the
 * database, and the database is what every channel reads, so it has to come off
 * before the text is written rather than on the way out of each one.
 *
 * Deliberately narrow. It removes an answer's wrapping and nothing else,
 * because a summariser that quietly edits what a model said about a
 * vulnerability is worse than one that leaves a stray sentence in.
 *
 * `isAnswer` is the other half: once the wrapping is off, a response that was
 * only wrapping is a model that failed, not an explanation. Saying so puts it
 * on the same path as an empty answer — which already has the better error
 * message, including the one about base models.
 */

/** How an answer-introducing line starts. Nothing else is treated as preamble. */
const OPENER =
    "(?:certainly|sure(?: thing)?|of course|absolutely|gladly|happy to help|as requested|great|understood|got it|okay|ok|here(?:'|’)?s|here is|below is|the following is)";

/** A whole line that is only a pleasantry: "Certainly!", "Of course." */
const PLEASANTRY_ONLY = new RegExp(`^${OPENER}[!.,…\\s]*$`, 'i');

/**
 * An opener running up to the colon that hands over to the answer.
 *
 * No newline and no full stop may appear before that colon: an explanation
 * whose first sentence merely begins with one of these words has ended that
 * sentence by then, and is not an introduction to anything.
 */
const OPENER_TO_COLON = new RegExp(`^${OPENER}\\b[^\\n:.]{0,120}:`, 'i');

/**
 * A markdown thematic break — `---`, `***`, `___` — opening the answer.
 *
 * Only ever the first line, which is what makes this safe: further down, `---`
 * under a line of text is a setext heading and removing it would silently
 * demote a heading to a paragraph. Nothing can be above the first line.
 */
const HORIZONTAL_RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/**
 * The whole answer inside one code fence.
 *
 * An explanation is prose. A model that fences it has labelled English as
 * source code, and every channel that renders markdown then shows it in a
 * monospace box.
 */
const WHOLLY_FENCED = /^```[^\n]*\n([\s\S]*?)\n?```$/;

/**
 * A first line that names the deliverable rather than saying anything.
 *
 * "**Mitigation Guide: Second-Order SQL Injection in Froxlor**" is the prompt
 * read back. The list is short and literal on purpose: `### What happened` is a
 * section the mitigation prompt asks for, and nothing here may touch it.
 */
const RESTATED_TITLE =
    /^\s*(?:#{1,6}\s*)?\**\s*(?:mitigation guide|remediation guide|security advisory|vulnerability (?:explanation|summary|report)|explanation|summary)\b[^\n]*$/i;

/** Two passes covers "Certainly!\n---\nHere is the explanation:"; a third is paranoia. */
const MAX_PASSES = 4;

/** Any letter or digit at all. Punctuation and markup alone are not an answer. */
const HAS_WORDS = /[\p{L}\p{N}]/u;

/**
 * The answer with its wrapping removed.
 *
 * Returns an empty string when the response was nothing but wrapping. That is
 * the point rather than an accident: `isAnswer` then reports it as the failure
 * it is, instead of "Certainly! Here's the explanation:" being stored as an
 * explanation.
 *
 * @param {string|null|undefined} answer
 * @returns {string|null|undefined}
 */
export function cleanAnswer(answer) {
    if (typeof answer !== 'string') return answer;

    let text = answer.trim();

    for (let pass = 0; pass < MAX_PASSES; pass++) {
        const before = text;

        const fenced = text.match(WHOLLY_FENCED);
        if (fenced) text = fenced[1].trim();

        const firstLine = text.split('\n', 1)[0];

        if (
            PLEASANTRY_ONLY.test(firstLine.trim()) ||
            HORIZONTAL_RULE.test(firstLine) ||
            RESTATED_TITLE.test(firstLine)
        ) {
            text = text.slice(firstLine.length).trimStart();
        } else {
            const opener = text.match(OPENER_TO_COLON);
            if (opener) text = text.slice(opener[0].length).trimStart();
        }

        if (text === before) break;
    }

    return text;
}

/**
 * Did the model answer at all?
 *
 * A response of ``` ``` ```, or of dashes, or of an introduction to an
 * explanation that never came, is a failure that reads as success: it is
 * truthy, so it was stored and shown as the explanation for a CVE.
 *
 * @param {string|null|undefined} text Already through cleanAnswer
 * @returns {boolean}
 */
export function isAnswer(text) {
    return typeof text === 'string' && HAS_WORDS.test(text);
}
