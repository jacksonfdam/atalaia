/**
 * The preamble a chat model puts in front of an answer.
 *
 * Half of these are the shapes that actually turned up; the other half are the
 * ones that must survive untouched, because a summariser that quietly edits
 * what a model said about a vulnerability is worse than a stray sentence.
 */
import { describe, test, expect } from '@jest/globals';
import { cleanAnswer, isAnswer } from '#app/infrastructure/llm/cleanAnswer.js';

describe('what gets removed', () => {
    test('the one that started this', () => {
        expect(
            cleanAnswer(
                "Certainly! Here's an explanation for your non-technical audience: The flaw lets an attacker read files."
            )
        ).toBe('The flaw lets an attacker read files.');
    });

    test('a pleasantry on a line of its own', () => {
        expect(cleanAnswer('Certainly!\n\nThe flaw lets an attacker read files.')).toBe(
            'The flaw lets an attacker read files.'
        );
    });

    test('a pleasantry and then an introduction, on two lines', () => {
        expect(cleanAnswer('Of course.\nHere is the explanation:\n\nThe flaw is serious.')).toBe(
            'The flaw is serious.'
        );
    });

    test.each([
        'Sure, here is what that means: It is bad.',
        'Absolutely — here is the summary: It is bad.',
        'Here is a plain-English explanation: It is bad.',
        'Below is the explanation: It is bad.',
        'Okay, here it is: It is bad.',
    ])('%s', answer => {
        expect(cleanAnswer(answer)).toBe('It is bad.');
    });

    test('leading and trailing whitespace goes with it', () => {
        expect(cleanAnswer('   \n Certainly: It is bad.  \n ')).toBe('It is bad.');
    });

    test.each(['---', '***', '___', '- - -', '  ---  '])('a rule opening the answer: %s', rule => {
        expect(cleanAnswer(`${rule}\n\n### What happened\n\nIt is bad.`)).toBe(
            '### What happened\n\nIt is bad.'
        );
    });

    test('a rule under a preamble goes with it', () => {
        expect(cleanAnswer('Certainly!\n---\n\nIt is bad.')).toBe('It is bad.');
    });
});

describe('what must survive', () => {
    test('an explanation that simply begins with one of those words', () => {
        const answer = 'Sure enough, the library shipped the flaw for two years.';
        expect(cleanAnswer(answer)).toBe(answer);
    });

    test('a colon later in a real first sentence', () => {
        // The full stop before the colon is what says this is prose, not an
        // introduction to prose.
        const answer = 'Absolutely nothing protects the endpoint. The impact is this: data loss.';
        expect(cleanAnswer(answer)).toBe(answer);
    });

    test('a heading the mitigation guide is supposed to have', () => {
        const answer = '### What happened\n\nAn unauthenticated visitor exhausts server memory.';
        expect(cleanAnswer(answer)).toBe(answer);
    });

    test('a rule further down is a heading underline, not a rule', () => {
        // Removing this one would demote the heading above it to a paragraph.
        const answer = 'What happened\n---\n\nIt is bad.';
        expect(cleanAnswer(answer)).toBe(answer);
    });

    test('a sentence that merely starts with dashes is not a rule', () => {
        const answer = '-- the maintainer, in the advisory';
        expect(cleanAnswer(answer)).toBe(answer);
    });

    test('a colon in an ordinary sentence', () => {
        const answer = 'Affected versions: 2.7.0 through 2.7.6.';
        expect(cleanAnswer(answer)).toBe(answer);
    });

    test('nothing is not something', () => {
        expect(cleanAnswer(null)).toBeNull();
        expect(cleanAnswer(undefined)).toBeUndefined();
        expect(cleanAnswer('')).toBe('');
    });
});

describe('a fence around the whole answer', () => {
    test('comes off', () => {
        expect(cleanAnswer('```\nIt is bad.\n```')).toBe('It is bad.');
    });

    test('comes off with a language tag too', () => {
        expect(cleanAnswer('```markdown\n### What happened\n\nIt is bad.\n```')).toBe(
            '### What happened\n\nIt is bad.'
        );
    });

    test('a fence around part of the answer stays', () => {
        // That one is a code sample, which a mitigation guide is meant to have.
        const answer = 'Upgrade it:\n\n```sh\nnpm i pkg@2\n```\n\nThen redeploy.';
        expect(cleanAnswer(answer)).toBe(answer);
    });
});

describe('a first line that names the deliverable', () => {
    test('the prompt read back is not the answer', () => {
        expect(
            cleanAnswer("**Mitigation Guide: SQL Injection in Froxlor**\n\nAn attacker can read rows.")
        ).toBe('An attacker can read rows.');
    });

    test.each([
        'Explanation:',
        '## Summary',
        '### Vulnerability Summary — CVE-2026-1',
    ])('%s', line => {
        expect(cleanAnswer(`${line}\n\nIt is bad.`)).toBe('It is bad.');
    });

    test('a section the guide is asked for is not a title', () => {
        const answer = '### What happened\n\nAn unauthenticated visitor exhausts server memory.';
        expect(cleanAnswer(answer)).toBe(answer);
    });

    test('a sentence that merely mentions one of those words survives', () => {
        const answer = 'The summary from the vendor understates the impact.';
        expect(cleanAnswer(answer)).toBe(answer);
    });
});

/**
 * The failure that read as success: all of these are truthy, so they were
 * stored and shown as the explanation for a CVE. One of them really was —
 * three characters of code fence, and nothing else.
 */
describe('isAnswer', () => {
    test.each([
        ['```', 'a fence and nothing inside it'],
        ['---', 'a rule and nothing under it'],
        ["Certainly! Here's the explanation:", 'an introduction to nothing'],
        ['', 'empty'],
        ['   \n  ', 'whitespace'],
        ['**', 'stray markup'],
        ['— …', 'punctuation'],
    ])('%s is not an answer (%s)', text => {
        expect(isAnswer(cleanAnswer(text))).toBe(false);
    });

    test.each([
        'It is bad.',
        '### What happened\n\nIt is bad.',
        '2',
    ])('%s is an answer', text => {
        expect(isAnswer(cleanAnswer(text))).toBe(true);
    });

    test('nothing is not an answer', () => {
        expect(isAnswer(null)).toBe(false);
        expect(isAnswer(undefined)).toBe(false);
    });
});
