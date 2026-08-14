import { PgBoss } from 'pg-boss';
import logger from '../logger.js';
import { connectionString, query, queryAll, queryOne } from '../db/pool.js';
import { QUEUE_DEFINITIONS } from './jobs.js';

/**
 * The queue, on the same Postgres as everything else.
 *
 * pg-boss keeps its tables in their own `pgboss` schema, so the application
 * schema stays readable and `\dt` still shows only our own tables.
 */

let boss = null;

export async function getBoss() {
    if (boss) return boss;

    boss = new PgBoss({
        connectionString: connectionString(),
        schema: process.env.PGBOSS_SCHEMA || 'pgboss',
        // Long enough that a quiet queue is not polling constantly, short enough
        // that a triggered scan feels immediate. pg-boss also listens for a
        // notification, so a new job usually starts without waiting this out.
        pollingIntervalSeconds: 2,
    });

    boss.on('error', err => logger.error({ err }, 'pg-boss error'));

    await boss.start();

    // Queues are explicit in pg-boss 10+, and creating them is idempotent, so
    // both the API and the worker can do it on boot.
    for (const definition of QUEUE_DEFINITIONS) {
        await boss.createQueue(definition.name, {
            policy: definition.policy,
            retryLimit: definition.retryLimit,
            retryDelay: definition.retryDelay,
            expireInSeconds: definition.expireInSeconds,
        });
    }

    logger.info({ queues: QUEUE_DEFINITIONS.length }, 'Queue ready');
    return boss;
}

export async function stopBoss() {
    if (!boss) return;
    await boss.stop({ wait: true });
    boss = null;
}

/**
 * Enqueue a job, reporting whether the queue's policy refused it.
 *
 * An `exclusive` queue answers null when one is already queued or active, which
 * is exactly the "already running" the API turns into a 409 — the same contract
 * the console has always polled, now enforced in the database.
 *
 * @param {string} queue
 * @param {object} [data]
 * @param {import('pg-boss').SendOptions} [options]
 * @returns {Promise<{ accepted: boolean, jobId: string|null }>}
 */
export async function enqueue(queue, data = {}, options = {}) {
    const instance = await getBoss();
    const jobId = await instance.send(queue, data, options);

    if (!jobId) {
        logger.info({ queue }, 'Job refused: one is already queued or active');
        return { accepted: false, jobId: null };
    }

    logger.info({ queue, jobId }, 'Job enqueued');
    return { accepted: true, jobId };
}

/**
 * What the console polls: whether anything is in flight on this queue, the
 * progress of it, and how the last one ended.
 *
 * @param {string} queue
 * @param {string} [singletonKey] Narrow to one key, for the per-repository jobs
 */
export async function queueState(queue, singletonKey = null) {
    const instance = await getBoss();

    const keyClause = singletonKey ? 'AND singleton_key = @singletonKey' : '';
    const schema = process.env.PGBOSS_SCHEMA || 'pgboss';

    // Read the job table directly: findJobs() cannot express "the most recent
    // one, whatever its state", which is what "how did the last run end" needs.
    const active = await queryOne(
        `SELECT id, created_on, started_on FROM ${schema}.job
         WHERE name = @queue AND state IN ('created', 'active', 'retry') ${keyClause}
         ORDER BY created_on DESC LIMIT 1`,
        { queue, singletonKey }
    );

    const last = await queryOne(
        `SELECT id, state, created_on, started_on, completed_on, output FROM ${schema}.job
         WHERE name = @queue AND state IN ('completed', 'failed', 'cancelled') ${keyClause}
         ORDER BY completed_on DESC NULLS LAST LIMIT 1`,
        { queue, singletonKey }
    );

    const progress = active ? await readProgress(active.id) : null;

    return {
        running: Boolean(active),
        jobId: active?.id ?? null,
        startedAt: active?.started_on ?? active?.created_on ?? null,
        progress,
        lastRun: last
            ? {
                  jobId: last.id,
                  startedAt: last.started_on ?? last.created_on,
                  finishedAt: last.completed_on,
                  ok: last.state === 'completed',
                  error: last.state === 'completed' ? null : errorFrom(last.output),
                  // Whatever the handler returned. A caller that promises its
                  // clients more than jobId and ok — the fleet scan reports
                  // counts — reads it from here.
                  output: last.state === 'completed' ? last.output ?? null : null,
              }
            : null,
    };
}

/** pg-boss stores a failure's payload in `output`; shapes vary by thrower. */
function errorFrom(output) {
    if (!output) return null;
    if (typeof output === 'string') return output;
    return output.message ?? output.error ?? JSON.stringify(output);
}

/** @param {string} jobId */
export async function readProgress(jobId) {
    const row = await queryOne('SELECT progress FROM job_progress WHERE job_id = @jobId', { jobId });
    return row?.progress ?? null;
}

/**
 * Record where a job has got to. Called by the worker as it goes, read by the
 * API — which is why it is a table and not a variable.
 *
 * @param {string} jobId
 * @param {string} queue
 * @param {object} progress
 */
export async function writeProgress(jobId, queue, progress) {
    await query(
        `INSERT INTO job_progress (job_id, queue, progress)
         VALUES (@jobId, @queue, @progress)
         ON CONFLICT (job_id) DO UPDATE SET
            progress = excluded.progress,
            updated_at = now()`,
        { jobId, queue, progress: JSON.stringify(progress) }
    );
}

/**
 * Progress rows outlive their jobs; pg-boss archives its own after a fortnight.
 * Called on worker boot rather than on a schedule of its own — the table is tiny
 * and one sweep a restart is enough.
 */
export async function pruneProgress() {
    const { rowCount } = await query(
        "DELETE FROM job_progress WHERE updated_at < now() - interval '14 days'"
    );
    if (rowCount > 0) logger.info({ rows: rowCount }, 'Pruned stale job progress');
}

/** Every queue and how deep it is, for /health and for the console. */
export async function queueDepths() {
    const schema = process.env.PGBOSS_SCHEMA || 'pgboss';

    return queryAll(
        `SELECT name AS queue,
                COUNT(*) FILTER (WHERE state = 'created') AS queued,
                COUNT(*) FILTER (WHERE state = 'active') AS active,
                COUNT(*) FILTER (WHERE state = 'failed') AS failed
         FROM ${schema}.job
         GROUP BY name
         ORDER BY name`
    );
}
