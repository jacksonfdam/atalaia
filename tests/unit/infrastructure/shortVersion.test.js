/**
 * One definition of the summary, read by every channel.
 *
 * Each of them used to keep its own `clientExplanation || description`, which
 * is the drift that let one channel show something another did not.
 *
 * The heading naming which of the two it was — *written by a model* / *from the
 * advisory* — was removed on request. `generated` still answers the question
 * for any caller that wants it; nothing renders it.
 */
import { describe, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { shortVersion } from '#app/infrastructure/notifiers/shortVersion.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Every file that puts a vulnerability summary in front of somebody. */
const CHANNELS = [
    'src/infrastructure/notifySlack.js',
    'src/infrastructure/notifiers/notifyTeams.js',
    'src/infrastructure/notifiers/notifyTelegram.js',
    'src/infrastructure/notifiers/emailTemplates.js',
    'src/application/generateWeeklyReport.js',
];

describe('which of the two it is', () => {
    test('the model explanation wins over the advisory text', () => {
        expect(shortVersion({ clientExplanation: 'A model wrote this.', description: 'Advisory text.' })).toEqual({
            text: 'A model wrote this.',
            generated: true,
        });
    });

    test('the database spelling of the column is read too', () => {
        expect(shortVersion({ client_explanation: 'A model wrote this.' }).generated).toBe(true);
    });

    test('the advisory text is the fallback, and says it was not generated', () => {
        expect(shortVersion({ description: 'Advisory text.' })).toEqual({
            text: 'Advisory text.',
            generated: false,
        });
    });

    test('neither one present is null, not an empty paragraph', () => {
        expect(shortVersion({})).toBeNull();
        expect(shortVersion({ description: '' })).toBeNull();
    });
});

describe('no channel reintroduces a label', () => {
    test.each(CHANNELS)('%s prints no source heading', file => {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf-8');

        expect(source).not.toMatch(/written by a model|from the advisory/i);
        expect(source).not.toMatch(/short\.source|explanationSource/);
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
