/**
 * Nothing a model wrote may reach a reader unlabelled.
 *
 * Every channel used to print the model's paragraph and the advisory's own
 * words under the same heading, each with its own copy of the fallback. The
 * label now travels with the text, from one definition.
 */
import { describe, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { shortVersion, MODEL_SOURCE, ADVISORY_SOURCE } from '#app/infrastructure/notifiers/shortVersion.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Every file that puts a vulnerability summary in front of somebody. */
const CHANNELS = [
    'src/infrastructure/notifySlack.js',
    'src/infrastructure/notifiers/notifyTeams.js',
    'src/infrastructure/notifiers/notifyTelegram.js',
    'src/infrastructure/notifiers/emailTemplates.js',
    'src/application/generateWeeklyReport.js',
];

describe('the summary says where it came from', () => {
    test('a model explanation is labelled as one', () => {
        expect(shortVersion({ clientExplanation: 'A model wrote this.', description: 'Advisory text.' })).toEqual({
            text: 'A model wrote this.',
            source: MODEL_SOURCE,
            generated: true,
        });
    });

    test('the database spelling of the column is read too', () => {
        expect(shortVersion({ client_explanation: 'A model wrote this.' }).generated).toBe(true);
    });

    test('the advisory text falls back labelled as the advisory', () => {
        expect(shortVersion({ description: 'Advisory text.' })).toEqual({
            text: 'Advisory text.',
            source: ADVISORY_SOURCE,
            generated: false,
        });
    });

    test('the two labels cannot be confused for each other', () => {
        expect(MODEL_SOURCE).not.toEqual(ADVISORY_SOURCE);
    });

    test('neither one present is null, not an empty paragraph', () => {
        expect(shortVersion({})).toBeNull();
        expect(shortVersion({ description: '' })).toBeNull();
    });
});

describe('the cap applies to the advisory only', () => {
    const long = 'x'.repeat(500);

    test('advisory text is cut to the limit', () => {
        const short = shortVersion({ description: long }, 100);

        expect(short.text).toHaveLength(100);
        expect(short.text.endsWith('…')).toBe(true);
    });

    test('a model paragraph is never cut here', () => {
        // The channel decides how much of it fits; this is not the place to
        // truncate something a model was asked to keep short already.
        expect(shortVersion({ clientExplanation: long }, 100).text).toHaveLength(500);
    });
});

describe('no channel keeps its own copy of the fallback', () => {
    test.each(CHANNELS)('%s reads the shared definition', file => {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf-8');

        expect(source).toMatch(/shortVersion/);
        // `clientExplanation || description` in a channel is the drift that
        // let generated text pass as the advisory's own words.
        expect(source).not.toMatch(/client_?[eE]xplanation\s*(\|\||\?\?)/);
    });
});
