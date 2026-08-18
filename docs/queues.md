# Queues

Everything that takes longer than a request is a job: the monitoring cycle, the fleet scan, a single repository scan, the dependency freshness check, batch explanations and the weekly report.

They used to run inside the API process, detached with a module-level variable and guarded by a `409` that only held for as long as that process lived. A restart lost the work *and* the progress describing it, and a second API container would have run everything twice. They are [pg-boss](https://github.com/timgit/pg-boss) jobs now, in the same Postgres as everything else — **no Redis**: the workload is an hourly cycle and a nightly sweep, and a second datastore would be a second place for state to disagree with the database.

## The queues

Defined once in `src/infrastructure/queue/jobs.js`, which the API, the worker and the schedules all read.

| Queue | Policy | Retries | What it does |
|-------|--------|---------|--------------|
| `monitor.cycle` | exclusive | 2, after 60s | Fetch every enabled feed, filter by stack, dedupe, notify |
| `repo.scanAll` | exclusive | none | Walk each organization: import what appeared, remove what is gone, scan each repository |
| `repo.scan` | standard | 2, after 30s | One repository's manifests |
| `deps.versions` | exclusive per repository | 1, after 60s | Ask each registry for the latest published version |
| `vuln.explain` | singleton | none | Write the model's text — an explanation or a mitigation guide — for a selection of CVEs |
| `report.weekly` | exclusive | 3, after 5min | The Monday digest |

**`exclusive` is the old `409`.** The queue allows one job queued or active at a time, so a second `send` returns no id — and that is what the API answers `409` to. The difference from the variable it replaced is that this holds after a restart, and across however many API containers are running.

`deps.versions` is exclusive *per repository*, through a `singletonKey` of `repo:<id>`: two repositories may be checked at once, the same one may not.

`vuln.explain` is a **singleton** rather than exclusive: one runs at a time, and a second selection queues behind it instead of being refused. Acknowledging a batch enqueues the mitigation guides for it, and refusing that because somebody else's batch is halfway through would be a queue lesson nobody asked for. It does not retry — a CVE the model choked on is recorded per CVE in the progress row, and replaying the batch would rewrite everything that already succeeded.

`repo.scan` is deliberately not exclusive — the jobs must be free to queue up. How many run at once is the worker's concurrency, `SCAN_CONCURRENCY` (default 10), the same number a fleet sweep uses inside its own job: the limit that matters is somebody else's rate limit, and it does not care which queue the work arrived on.

**Concurrency.** A sweep of four hundred repositories at ten seconds each is over an hour one at a time, so repositories are scanned in parallel — ten by default. Each one is an independent read of the provider followed by a write of its own rows, so they do not contend with each other; what they share is the GitHub token's 5000 requests an hour, which parallelism spends faster rather than differently. Set `SCAN_CONCURRENCY`, or pass `{"concurrency": N}` to `POST /api/v1/repositories/scan-all` for one run (`atalaia repo scan --all --concurrency N`).

## Schedules

Rows in the database, not `node-cron` calls in every process that boots:

| Queue | Cron from | Default |
|-------|-----------|---------|
| `monitor.cycle` | the `cronSchedule` setting | `0 * * * *` |
| `repo.scanAll` | the `repositories.scanCron` setting, and only when `repositories.autoScan` is on | `0 3 * * *` |
| `report.weekly` | `WEEKLY_REPORT_CRON` | `0 9 * * 1` |

The worker registers them on boot, so changing a schedule in the console takes effect when the worker restarts — the same as it needed before. Turning `autoScan` off *unschedules* the sweep rather than skipping it, so an earlier boot's schedule does not linger.

## Progress

A pg-boss payload is immutable, so progress lives in its own table, `job_progress`, keyed by job id and written by the worker as it goes. The API reads it, which a module-level variable never allowed.

The HTTP contract the console polls did not change:

| Route | Behaviour |
|-------|-----------|
| `POST /api/v1/scan` | `202` with a `jobId`, or `409` while one is running |
| `GET /api/v1/scan` | `running`, `jobId`, `progress`, `lastRun` |
| `POST /api/v1/repositories/scan-all` | `202`, or `409` |
| `GET /api/v1/repositories/scan-all` | fleet progress: organizations and repositories done, which one is current, errors |
| `DELETE /api/v1/repositories/scan-all` | Cancel the sweep, and unstick the queue when it thinks one is running |
| `POST /api/v1/repositories/:id/scan` | `202` for one repository |
| `POST /api/v1/repositories/:id/versions` | `202`, or `409` if that repository is already being checked |

## Looking inside

```bash
./scripts/atalaia.sh logs atalaia-worker

# Queue depths
psql "$DATABASE_URL" -c "
  SELECT name, state, count(*) FROM pgboss.job GROUP BY name, state ORDER BY name;"

# The registered schedules
psql "$DATABASE_URL" -c "SELECT name, cron FROM pgboss.schedule;"

# What failed, and why
psql "$DATABASE_URL" -c "
  SELECT name, created_on, output FROM pgboss.job
  WHERE state = 'failed' ORDER BY created_on DESC LIMIT 5;"
```

From the terminal client:

```bash
atalaia scan                # queue a cycle
atalaia status              # what is stored
atalaia repo scan --all     # queue the fleet sweep
atalaia repo scan-status    # follow it
```

## What happens when a worker dies

The job stays in the queue. It is not lost — which is the whole point of the change — but it is not instantly retried either: pg-boss notices an abandoned `active` job when its `expireInSeconds` window passes, and only then hands it to someone else. That window is per queue (15 minutes for a monitoring cycle, an hour for a fleet sweep) and it is a trade: shorter means faster recovery, longer means a slow-but-alive job is not killed and restarted underneath itself.

A clean `docker stop` is different — the worker finishes the job in hand if it can, and stops taking new ones.

Rebuilding the containers mid-sweep is the case that bites: the worker is replaced, its job stays `active`, and an exclusive queue refuses new work until the window passes. When that happens:

```bash
atalaia repo scan-cancel      # or: DELETE /api/v1/repositories/scan-all
```

The windows are sized for the work: 15 minutes for a monitoring cycle, 30 for a fleet sweep — which is generous now that a sweep of four hundred repositories is minutes rather than an hour.
