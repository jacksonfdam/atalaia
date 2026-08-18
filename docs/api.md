# REST API

Everything under `/api/v1` requires the `X-API-Key` header. `/health` is public; `/api/v1/slack/actions` authenticates by Slack signature instead. `/mcp` serves the same data to agents over Model Context Protocol, behind the same key — see [mcp.md](mcp.md).

A request may also carry `X-Session-Token`, which is how the console says *which person* is asking. It is checked against the database, and a stale one is refused with `401` and `{"code":"session_required"}` rather than falling back to key-only access. A request without it — the CLI, an agent — is a machine client and the key is enough. See [authentication.md](authentication.md).

Anything that outlives a request is queued rather than run: those endpoints answer `202` with a `jobId`, refuse a second concurrent run with `409`, and report progress on a `GET` at the same path. See [queues.md](queues.md).

```bash
curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/vulnerabilities
curl -H "X-API-Key: $API_KEY" "http://localhost:3000/api/v1/vulnerabilities?severity=CRITICAL"
curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/stats

curl -X PATCH -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"status":"ACKNOWLEDGED","changedBy":"security-team"}' \
  http://localhost:3000/api/v1/vulnerabilities/CVE-2024-0001/status
```

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/health` | Liveness. No auth. |
| `GET` | `/api/v1/stats` | Counts by severity, status, source and technology, plus 30 days of activity. |
| `POST` | `/api/v1/query` | Query by technology list. |
| `GET` | `/api/v1/callbacks` | The public URL Slack and Telegram were given, where it came from, and the tunnel providers available. |
| `GET` | `/api/v1/auth/state` | Whether an account exists yet, and whether break-glass is on. |
| `POST` | `/api/v1/auth/registration/options` `/verify` | Enroll a passkey: the first account, an invited one, an extra one, or break-glass. |
| `POST` | `/api/v1/auth/authentication/options` `/verify` | Sign in. `verify` returns a session token. |
| `GET` | `/api/v1/auth/me` | The account behind the session token, its passkey count and codes left. |
| `POST` | `/api/v1/auth/logout` | Revoke this session. |
| `GET` `POST` | `/api/v1/auth/credentials` | List this account's passkeys / begin enrolling another. |
| `PATCH` `DELETE` | `/api/v1/auth/credentials/:id` | Rename / remove. Removing the last one is refused with `409`. |
| `POST` | `/api/v1/auth/recovery/verify` | Spend a recovery code. Returns a session that may only enroll a passkey. |
| `POST` | `/api/v1/auth/recovery/codes` | Issue ten new codes, invalidating the outstanding ones. |
| `GET` | `/api/v1/auth/users` | Accounts and their passkey counts. Administrators only. |
| `GET` `POST` | `/api/v1/auth/invites` | Outstanding invitations / create one. The token is returned once. |
| `DELETE` | `/api/v1/auth/invites/:id` | Revoke an invitation. |
| `POST` | `/api/v1/auth/users/:id/reset` | Remove every passkey, end the sessions, reissue codes. |
| `GET` | `/api/v1/vulnerabilities` | List with filters and pagination, including `relevance`. |
| `GET` | `/api/v1/vulnerabilities/:cveId` | One CVE, with explanation and timeline. |
| `PATCH` | `/api/v1/vulnerabilities/:cveId/status` | Acknowledge / resolve. |
| `POST` | `/api/v1/vulnerabilities/:cveId/explain` | Write the plain-English explanation now, for a CVE collected before a model was configured. Answers `400` with the model's own reason when it fails. |
| `PATCH` | `/api/v1/vulnerabilities/batch/status` | Acknowledge or resolve a selection, up to 200. Always `200`: each CVE is reported with its own outcome. |
| `GET` `POST` | `/api/v1/vulnerabilities/batch/explain` | Batch text job status / queue one (`202`). |
| `GET` | `/api/v1/technologies` | Current stack filter. |
| `POST` | `/api/v1/technologies` | Update the stack filter. |
| `GET` | `/api/v1/feeds` | Every source, its state and its catalog entry. |
| `PATCH` | `/api/v1/feeds/:name` | Enable or disable a source (`{ "enabled": true }`). |
| `DELETE` | `/api/v1/feeds/:name/override` | Follow the registry default again. |
| `GET` | `/api/v1/feeds/catalog` | Every public database Atalaia knows about, collected or not. |
| `GET` | `/api/v1/feeds/health` | Per-feed items, CVSS coverage, latency, failure reason. |
| `GET` `POST` | `/api/v1/organizations` | List / register an organization (`{ login, key?, name?, token? }`). |
| `GET` `PATCH` `DELETE` | `/api/v1/organizations/:key` | Inspect / update token and state / remove with its repositories. |
| `GET` | `/api/v1/organizations/:key/repositories` | What the token can see, annotated with what is already tracked. Reads only. |
| `POST` | `/api/v1/organizations/:key/import` | Import that organization's repositories, or a subset via `{"repositories":["org/a"]}`. |
| `POST` | `/api/v1/organizations/import` | Import every enabled organization. |
| `GET` `POST` | `/api/v1/repositories` | List (filtered, sorted, paginated) / add a monitored repository. |
| `GET` `PATCH` `DELETE` | `/api/v1/repositories/:idOrUrl` | Inspect / enable-disable / soft-delete. |
| `POST` | `/api/v1/repositories/:idOrUrl/restore` | Undo a soft delete. |
| `GET` | `/api/v1/repositories/:idOrUrl/dependencies` | Parsed dependencies, with the latest published version of each. |
| `GET` `POST` | `/api/v1/repositories/:idOrUrl/versions` | Progress of the freshness check / queue one (`202`, or `409` if that repository is already being checked). |
| `GET` | `/api/v1/repositories/:idOrUrl/vulnerabilities` | Which CVEs reach this repository, and through which dependency. |
| `GET` `POST` | `/api/v1/repositories/:idOrUrl/technologies` | Languages, topics and ecosystems / re-read languages from the provider. |
| `POST` | `/api/v1/repositories/:idOrUrl/scan` | Queue a scan of one repository (`202`). |
| `GET` `POST` `DELETE` | `/api/v1/repositories/scan-all` | Progress of the fleet scan / queue one (`202`, or `409` while one runs; `{"concurrency": N}` overrides how many at a time) / cancel it. |
| `GET` `POST` | `/api/v1/owners` | List / create owners. |
| `GET` `PATCH` `DELETE` | `/api/v1/owners/:id` | Manage one owner. |
| `POST` | `/api/v1/owners/:id/assignments` | Assign an ecosystem / dependency / repository. |
| `DELETE` | `/api/v1/owners/:id/assignments/:assignmentId` | Remove an assignment. |
| `GET` `POST` | `/api/v1/scan` | Monitoring cycle status / queue one (`202`, or `409` while one runs). |
| `GET` `PUT` | `/api/v1/settings` | Runtime settings. |
| `GET` `PUT` | `/api/v1/settings/email` | Email provider catalog and delivery configuration. |
| `GET` `PUT` | `/api/v1/settings/slack` | Slack integration: webhook or bot token, and the destination. |
| `POST` | `/api/v1/settings/slack/test` | Post a test message to the configured destination. |
| `GET` `PUT` | `/api/v1/settings/teams` | Microsoft Teams webhook. |
| `POST` | `/api/v1/settings/teams/test` | Post a test card to the Teams channel. |
| `GET` `PUT` | `/api/v1/settings/llm` | Model provider catalog and the configured model. |
| `POST` | `/api/v1/settings/llm/test` | Send one short prompt to the configured model. |
| `POST` | `/api/v1/settings/email/test` | Verify the SMTP connection, or `{"send":true}` to deliver a test digest. |
| `GET` | `/api/v1/reports/weekly` | The digest the email sends: `affecting` grouped by repository, `infrastructure` and `other` capped, `dependencies` behind. `?windowDays=N` changes the period. |
| `GET` `PUT` | `/api/v1/settings/telegram` | Bot token, chat id, and what Telegram was told to call. |
| `POST` | `/api/v1/settings/telegram/test` | Post a real message to the configured chat. |
| `GET` | `/api/v1/settings/telegram/chats` | Chats the bot has heard from, newest first — where a chat id comes from. |
| `POST` `DELETE` | `/api/v1/settings/telegram/webhook` | Register the callback at `PUBLIC_URL`, the tunnel, or a URL you pass / remove it. |
| `POST` | `/api/v1/slack/actions` | Slack interactive callbacks (signature-verified). |
| `POST` | `/api/v1/telegram/webhook` | Telegram button callbacks (secret-token-verified). |
| `POST` | `/mcp` | Model Context Protocol, for agents. Stateless; `GET`/`DELETE` answer `405`. |

## Batch actions

A selection made in the console arrives as one call. Two of them, because they
answer at different speeds.

**Status** is synchronous, and always `200` — never `400` because one CVE in the
selection could not move. A selection taken off a table will contain rows that
are already resolved or that somebody acknowledged a second ago, and failing the
whole call over those means ticking boxes one at a time to find out which. Each
CVE is reported with its own outcome instead.

```bash
curl -X PATCH -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"cveIds":["CVE-2024-0001","CVE-2024-0002"],"status":"ACKNOWLEDGED","changedBy":"security-team"}' \
  http://localhost:3000/api/v1/vulnerabilities/batch/status
```

```json
{
  "requested": 2, "changed": 1, "skipped": 1,
  "changedIds": ["CVE-2024-0001"],
  "results": [
    { "cveId": "CVE-2024-0001", "ok": true, "status": "ACKNOWLEDGED" },
    { "cveId": "CVE-2024-0002", "ok": false, "error": "Invalid transition: RESOLVED → ACKNOWLEDGED" }
  ],
  "mitigation": { "accepted": true, "jobId": "…", "queued": 1 }
}
```

`mitigation` is there because acknowledging one CVE writes a mitigation guide,
which is a model call. Fifty of them is not something a request can do, so the
batch queues them and ends up where the single-CVE route ends up. It is `null`
for a resolve, and carries a `reason` instead of a `jobId` when no model is
configured — the status change still happened either way.

**Text** is a job. `POST` takes the same `cveIds`, plus `kind`
(`explanation`, the default, or `mitigation`) and `force`. Without `force` a CVE
that already has text is skipped, since the usual reason to run this is to fill
in what was collected before a model was configured. A batch with no model
configured is refused with `400` rather than queued to fail on every row.

```bash
curl -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"cveIds":["CVE-2024-0001"],"force":false}' \
  http://localhost:3000/api/v1/vulnerabilities/batch/explain

curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/vulnerabilities/batch/explain
```

The `GET` reports `{ running, jobId, progress, lastRun }` like every other job,
with `progress` counting `done`, `written`, `skipped` and `failed` and naming
the CVE in hand. Failures are listed per CVE, capped at 20 with
`errorsTruncated` set when there were more.

Both cap a selection at **200 CVEs** and refuse a larger one with `400`. A
console page holds fifty; the cap is there so a scripted caller cannot hand the
worker a job that outlives its own expiry window. The same CVE sent twice counts
once.
