# REST API

Everything under `/api/v1` requires the `X-API-Key` header. `/health` is public; `/api/v1/slack/actions` authenticates by Slack signature instead. `/mcp` serves the same data to agents over Model Context Protocol, behind the same key — see [mcp.md](mcp.md).

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
| `GET` | `/api/v1/vulnerabilities` | List with filters and pagination, including `relevance`. |
| `GET` | `/api/v1/vulnerabilities/:cveId` | One CVE, with explanation and timeline. |
| `PATCH` | `/api/v1/vulnerabilities/:cveId/status` | Acknowledge / resolve. |
| `POST` | `/api/v1/vulnerabilities/:cveId/explain` | Write the plain-English explanation now, for a CVE collected before a model was configured. Answers `400` with the model's own reason when it fails. |
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
| `POST` | `/api/v1/slack/actions` | Slack interactive callbacks (signature-verified). |
| `POST` | `/mcp` | Model Context Protocol, for agents. Stateless; `GET`/`DELETE` answer `405`. |
