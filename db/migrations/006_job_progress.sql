-- Progress of long-running jobs.
--
-- pg-boss owns the queue and the state machine (created, active, completed,
-- failed) in its own schema, but a job's payload is immutable: there is nowhere
-- in it to record "42 of 130 repositories done, currently on acme/web".
--
-- That used to live in a module-level variable, which meant a restart erased it
-- and a second container could not see it at all. Here it survives both.
CREATE TABLE IF NOT EXISTS job_progress (
    job_id      uuid PRIMARY KEY,
    queue       text NOT NULL,
    -- Free-shaped: each job type reports what makes sense for it, and the
    -- console renders whatever it finds.
    progress    jsonb NOT NULL DEFAULT '{}'::jsonb,
    started_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_progress_queue ON job_progress (queue, started_at DESC);
