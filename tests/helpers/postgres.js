/**
 * A throwaway Postgres schema per test suite.
 *
 * Suites run in parallel and all point at one database, so each one gets its own
 * schema and a search_path that only sees it: no suite can read another's rows,
 * and a suite that crashes leaves a schema behind rather than poisoning the
 * others.
 *
 * TEST_DATABASE_URL is deliberately separate from DATABASE_URL — nobody should
 * be able to wipe a real database by running the tests. With it unset the
 * suites skip themselves, so `pnpm test` still runs the unit tests on a machine
 * with no Postgres.
 *
 *   docker run -d -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres pnpm test
 */

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? null;
export const hasDatabase = Boolean(TEST_DATABASE_URL);

/** Jest's `describe` unless there is no database, in which case skip the suite. */
export const describeWithDatabase = hasDatabase
    ? global.describe
    : (name, fn) => global.describe.skip(`${name} (skipped: TEST_DATABASE_URL is not set)`, fn);

/**
 * Point DATABASE_URL at a fresh schema. Call this *before* importing anything
 * that touches the pool — it is built lazily from the variable.
 *
 * @param {string} name Suite name, for a schema a human can recognise
 * @returns {{ schema: string, url: string }}
 */
export function useSchema(name) {
    if (!hasDatabase) return { schema: null, url: null };

    const schema = `test_${name}_${process.pid}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    const url = new URL(TEST_DATABASE_URL);
    // libpq's -c option, which node-postgres passes through: every connection
    // from this pool resolves unqualified names inside the suite's own schema.
    url.searchParams.set('options', `-csearch_path=${schema}`);

    process.env.DATABASE_URL = url.toString();

    // pg-boss keeps its own schema, and it is global by default: without this a
    // suite would see the queue of whatever else is using the same database —
    // including a developer's running worker — and read it as "a cycle is
    // already running".
    process.env.PGBOSS_SCHEMA = `${schema}_pgboss`;

    return { schema, url: url.toString() };
}

/**
 * Create the schema, then run the migrations into it.
 * Import the pool lazily so useSchema() has already set DATABASE_URL.
 */
export async function setUpSchema(schema) {
    const { query } = await import('#app/infrastructure/db/pool.js');
    const { runMigrations } = await import('#app/infrastructure/db/migrationRunner.js');

    // CREATE SCHEMA cannot itself run inside the missing schema, so it is sent
    // with an explicit name before search_path matters.
    await query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await runMigrations();
}

/** Stop the queue, drop both schemas, close the pool. */
export async function tearDownSchema(schema) {
    const { query, closePool } = await import('#app/infrastructure/db/pool.js');
    const { stopBoss } = await import('#app/infrastructure/queue/boss.js');

    await stopBoss();
    await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await query(`DROP SCHEMA IF EXISTS ${schema}_pgboss CASCADE`);
    await closePool();
}

/**
 * Empty every table without dropping the schema, between tests.
 *
 * The queue is emptied too: a job left behind by the previous test would make
 * an exclusive queue refuse the next one, and the failure reads as a broken
 * endpoint rather than as leftover state.
 */
export async function truncateAll() {
    const { query, queryAll } = await import('#app/infrastructure/db/pool.js');

    const rows = await queryAll(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = current_schema() AND tablename <> '_migrations'`
    );

    if (rows.length > 0) {
        const tables = rows.map(row => `"${row.tablename}"`).join(', ');
        await query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
    }

    const queueSchema = process.env.PGBOSS_SCHEMA;
    if (!queueSchema) return;

    const jobTable = await queryAll(
        `SELECT tablename FROM pg_tables WHERE schemaname = @schema AND tablename = 'job'`,
        { schema: queueSchema }
    );

    if (jobTable.length > 0) await query(`TRUNCATE ${queueSchema}.job CASCADE`);
}
