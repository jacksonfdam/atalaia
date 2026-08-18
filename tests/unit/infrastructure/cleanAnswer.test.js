/**
 * The preamble a chat model puts in front of an answer.
 *
 * Half of these are the shapes that actually turned up; the other half are the
 * ones that must survive untouched, because a summariser that quietly edits
 * what a model said about a vulnerability is worse than a stray sentence.
 */
import { describe, test, expect } from '@jest/globals';
import { cleanAnswer } from '#app/infrastructure/llm/cleanAnswer.js';

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

    test('an answer that is nothing but an introduction is left alone', () => {
        // Blanking it would hide a model failing behind an empty explanation.
        const answer = "Certainly! Here's the explanation:";
        expect(cleanAnswer(answer)).toBe(answer);
    });

    test('a rule further down is a heading underline, not a rule', () => {
        // Removing this one would demote the heading above it to a paragraph.
        const answer = 'What happened\n---\n\nIt is bad.';
        expect(cleanAnswer(answer)).toBe(answer);
    });

    test('an answer that is nothing but a rule is left alone', () => {
        expect(cleanAnswer('---')).toBe('---');
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
