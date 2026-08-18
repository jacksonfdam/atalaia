/**
 * Strip the throat-clearing a chat model puts in front of an answer.
 *
 * Asked for a paragraph, an assistant-tuned model tends to hand back
 * "Certainly! Here's an explanation for your non-technical audience:" and then
 * the paragraph. The prompts now say not to, but a prompt is a request and not
 * a guarantee, so what actually stops it is this — and stored text is what
 * every channel reads, so it has to be clean before it is written, not on the
 * way out of each one.
 *
 * Deliberately narrow. It removes an opener that introduces the answer, and a
 * horizontal rule drawn above it; it does not touch anything else, because a
 * summariser that quietly edits what a model said about a vulnerability is
 * worse than one that leaves a stray sentence in.
 */

/** How an answer-introducing line starts. Nothing else is treated as preamble. */
const OPENER =
    "(?:certainly|sure(?: thing)?|of course|absolutely|gladly|happy to help|as requested|great|understood|got it|okay|ok|here(?:'|’)?s|here is|below is|the following is)";

/** A whole line that is only a pleasantry: "Certainly!", "Of course." */
const PLEASANTRY_ONLY = new RegExp(`^${OPENER}[!.,…\\s]*$`, 'i');

/**
 * A markdown thematic break — `---`, `***`, `___` — opening the answer.
 *
 * The mitigation guide asks for numbered sections and some models introduce
 * them with a rule, which renders as a stray line above the first heading in
 * every channel and as literal dashes in the ones that do not render markdown.
 *
 * Only ever the first line, which is what makes this safe: further down, `---`
 * under a line of text is a setext heading and removing it would silently
 * demote a heading to a paragraph. Nothing can be above the first line.
 */
const HORIZONTAL_RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/**
 * An opener running up to the colon that hands over to the answer.
 *
 * No newline and no full stop may appear before that colon: an explanation
 * whose first sentence merely begins with one of these words has ended that
 * sentence by then, and is not an introduction to anything.
 */
const OPENER_TO_COLON = new RegExp(`^${OPENER}\\b[^\\n:.]{0,120}:`, 'i');

/** Two passes covers "Certainly!\\nHere is the explanation:"; a third is paranoia. */
const MAX_PASSES = 3;

/**
 * @param {string|null|undefined} answer
 * @returns {string|null|undefined} The same value, minus any preamble
 */
export function cleanAnswer(answer) {
    if (typeof answer !== 'string') return answer;

    let text = answer.trim();

    for (let pass = 0; pass < MAX_PASSES; pass++) {
        const before = text;
        const firstLine = text.split('\n', 1)[0];

        if (PLEASANTRY_ONLY.test(firstLine.trim()) || HORIZONTAL_RULE.test(firstLine)) {
            // Same guard as below: what is left has to be an answer.
            if (text.slice(firstLine.length).trim()) {
                text = text.slice(firstLine.length).trimStart();
            }
        } else {
            const opener = text.match(OPENER_TO_COLON);

            // Only when something survives it. An answer that is nothing but an
            // introduction is a model failing, and blanking it here would hide
            // that behind an empty explanation.
            if (opener && text.slice(opener[0].length).trim()) {
                text = text.slice(opener[0].length).trimStart();
            }
        }

        if (text === before) break;
    }

    return text;
}
