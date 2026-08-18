/**
 * jobs.js is the definition of every queue — including for a database that has
 * seen that queue before.
 *
 * createQueue is idempotent, and idempotent means no-op: it leaves an existing
 * queue exactly as it was, options and all. So editing an expiry changed the
 * file and nothing else, and the two disagreed silently. That was found by
 * shortening an expiry window and watching the old one still apply, which is a
 * bad way to find it.
 *
 * The policy is the exception pg-boss will not budge on — it decides how jobs
 * already in the table are handed out, so it cannot change under them. A
 * mismatch there is logged rather than applied.
 */
import { test, expect, beforeAll, afterAll } from '@jest/globals';
import {
    describeWithDatabase as describe,
    hasDatabase,
    useSchema,
    setUpSchema,
    tearDownSchema,
} from '../../helpers/postgres.js';

const { schema } = useSchema('queue_definitions');

const { QUEUE_DEFINITIONS } = await import('#app/infrastructure/queue/jobs.js');
const { getBoss, stopBoss } = await import('#app/infrastructure/queue/boss.js');
const { queryAll } = await import('#app/infrastructure/db/pool.js');

beforeAll(async () => {
    if (!hasDatabase) return;
    await setUpSchema(schema);
});

afterAll(async () => {
    if (!hasDatabase) return;
    await stopBoss();
    await tearDownSchema(schema);
});

/** What pg-boss actually holds, keyed by queue name. */
async function registered() {
    const rows = await queryAll(
        `SELECT name, policy, retry_limit, expire_seconds
         FROM ${process.env.PGBOSS_SCHEMA}.queue`
    );
    return new Map(rows.map(row => [row.name, row]));
}

describe('the queue definitions reach the database', () => {
    test('every queue in jobs.js exists with the options it declares', async () => {
        await getBoss();
        const queues = await registered();

        for (const definition of QUEUE_DEFINITIONS) {
            expect(queues.has(definition.name)).toBe(true);

            expect(queues.get(definition.name)).toMatchObject({
                policy: definition.policy,
                retry_limit: definition.retryLimit,
                expire_seconds: definition.expireInSeconds,
            });
        }
    });

    // The bug itself: a second boot with a changed definition used to leave the
    // first boot's options in place.
    test('a changed expiry is applied to a queue that already exists', async () => {
        const boss = await getBoss();
        const [first] = QUEUE_DEFINITIONS;

        // Stand in for an older boot having created it differently.
        await boss.updateQueue(first.name, { expireInSeconds: 77, retryLimit: 9 });
        expect((await registered()).get(first.name)).toMatchObject({
            expire_seconds: 77,
            retry_limit: 9,
        });

        // Booting again is what has to put it back.
        await stopBoss();
        await getBoss();

        expect((await registered()).get(first.name)).toMatchObject({
            expire_seconds: first.expireInSeconds,
            retry_limit: first.retryLimit,
        });
    });

    // Not a limitation to hide: a policy decides how jobs already queued are
    // handed out, so pg-boss will not change it under them. Booting must not
    // fail over it, and must not pretend it applied either.
    test('a policy that cannot be changed does not stop the boot', async () => {
        const boss = await getBoss();
        const singleton = QUEUE_DEFINITIONS.find(q => q.policy === 'singleton');
        const other = QUEUE_DEFINITIONS.find(q => q.policy !== 'singleton');

        await expect(
            boss.updateQueue(singleton.name, { policy: other.policy })
        ).rejects.toThrow(/policy/i);

        await stopBoss();
        await expect(getBoss()).resolves.toBeDefined();
        expect((await registered()).get(singleton.name).policy).toBe(singleton.policy);
    });
});
