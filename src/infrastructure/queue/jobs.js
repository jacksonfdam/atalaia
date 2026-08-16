/**
 * The one list of queues.
 *
 * Same reason feedRegistry.js is the one list of feeds: the API enqueues, the
 * worker consumes and the scheduler fires, and a queue that exists in one of
 * those places but not the others fails silently.
 *
 * The policy column is where the old in-memory `409` guard went. pg-boss
 * enforces it in the database, so it survives a restart and holds across two
 * containers — neither of which the module-level `let currentRun` could do.
 *
 *   exclusive — one job queued or active at a time. Sending a second returns
 *               null instead of an id, which is what the routes answer 409 to.
 *   singleton — one *active* at a time, others wait their turn.
 *   standard  — no constraint.
 */

export const QUEUES = {
    /** Fetch every enabled feed, filter, dedupe, notify. */
    MONITOR_CYCLE: 'monitor.cycle',
    /** Walk the fleet, enqueuing one repo.scan per enabled repository. */
    REPO_SCAN_ALL: 'repo.scanAll',
    /** Scan one repository's manifests. */
    REPO_SCAN: 'repo.scan',
    /** Ask each registry for the latest published version, per repository. */
    DEPS_VERSIONS: 'deps.versions',
    /** The Monday digest. */
    REPORT_WEEKLY: 'report.weekly',
    /** Delete spent challenges and long-dead sessions. */
    AUTH_SWEEP: 'auth.sweep',
};

/**
 * @typedef {object} QueueDefinition
 * @property {string} name
 * @property {'exclusive'|'singleton'|'standard'} policy
 * @property {number} retryLimit
 * @property {number} retryDelay      Seconds before a retry
 * @property {number} expireInSeconds A job still active after this is retried
 * @property {string} why             Why this policy, for whoever changes it next
 */

/** @type {QueueDefinition[]} */
export const QUEUE_DEFINITIONS = [
    {
        name: QUEUES.MONITOR_CYCLE,
        policy: 'exclusive',
        retryLimit: 2,
        retryDelay: 60,
        expireInSeconds: 900,
        why: 'Two concurrent cycles would double every outbound request for no benefit.',
    },
    {
        name: QUEUES.REPO_SCAN_ALL,
        policy: 'exclusive',
        retryLimit: 0,
        retryDelay: 0,
        // Sized for the sweep it actually is: several hundred repositories, ten
        // at a time, is minutes. It was an hour when the sweep was sequential,
        // and that hour was how long an exclusive queue stayed blocked after a
        // worker was killed mid-sweep — pg-boss only reclaims an abandoned
        // active job when its window passes.
        expireInSeconds: 1800,
        why: 'One sweep at a time: two would walk the same organizations and scan everything twice.',
    },
    {
        name: QUEUES.REPO_SCAN,
        policy: 'standard',
        retryLimit: 2,
        retryDelay: 30,
        expireInSeconds: 600,
        why: 'How many run at once is the worker\'s concurrency (SCAN_CONCURRENCY), not the queue\'s: the jobs must be allowed to queue up.',
    },
    {
        name: QUEUES.DEPS_VERSIONS,
        policy: 'exclusive',
        retryLimit: 1,
        retryDelay: 60,
        expireInSeconds: 1800,
        why: 'Per repository, via singletonKey: two checks of the same repository would ask every registry twice.',
    },
    {
        name: QUEUES.REPORT_WEEKLY,
        policy: 'exclusive',
        retryLimit: 3,
        retryDelay: 300,
        expireInSeconds: 600,
        why: 'One digest per run. Retries are generous because SMTP fails transiently and a missed digest is a week late.',
    },
    {
        name: QUEUES.AUTH_SWEEP,
        policy: 'exclusive',
        retryLimit: 0,
        retryDelay: 0,
        expireInSeconds: 120,
        why: 'Two DELETEs racing over the same rows achieve nothing the first one did not. A missed run costs storage and nothing else — expiry is enforced in the query, not by the sweep.',
    },
];

/**
 * Schedules, in the database rather than in a node-cron call: two API containers
 * would each have fired their own copy of every cron, and a restart forgot them.
 *
 * `cron` here is the *fallback*; the operator's value comes from the settings
 * table and is read when the worker registers these.
 */
export const SCHEDULES = [
    { queue: QUEUES.MONITOR_CYCLE, setting: 'cronSchedule', fallback: '0 * * * *' },
    { queue: QUEUES.REPO_SCAN_ALL, setting: 'repositories.scanCron', fallback: '0 3 * * *', enabledSetting: 'repositories.autoScan' },
    { queue: QUEUES.REPORT_WEEKLY, env: 'WEEKLY_REPORT_CRON', fallback: '0 9 * * 1' },
    { queue: QUEUES.AUTH_SWEEP, env: 'AUTH_SWEEP_CRON', fallback: '17 * * * *' },
];
