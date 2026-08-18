# Console and CLI

## Console

The management console is a **separate service** (`ui/`, port 3001). It talks to the Atalaia API over HTTP only — it never opens the database and holds no business logic — so it can run on a different host from the API.

```bash
./scripts/atalaia.sh up
open http://localhost:3001
```

| Page | What it manages |
|------|-----------------|
| Overview | Counts by severity/status/source, open criticals, trigger a monitoring cycle |
| Vulnerabilities | Filter, paginate, acknowledge and resolve — one row at a time, or a ticked selection in batch |
| Reports | The weekly digest as the email sends it: findings grouped by repository, each with the dependency it arrives through and a short explanation. *Send now* mails it immediately |
| Sources | Enable/disable each source, live per-feed health, and the full database catalog |
| Repositories | Add, enable/disable, scan, inspect technologies and parsed dependencies, and subscribe someone to be told when a CVE reaches one |
| Settings | Everything configurable, one tab at a time |

Settings is tabbed, because stacking every integration on one page made the bottom of it unreachable. Each tab has its own URL, so `/settings/slack` is a link you can send someone:

| Tab | Path | What it manages |
|-----|------|-----------------|
| General | `/settings/general` | Schedules, switches, and which environment secrets are present |
| Passkeys | `/settings/account` | This account's passkeys and its recovery codes |
| People | `/settings/people` | Accounts, invitations and resets. Administrators only |
| Organizations | `/settings/organizations` | GitHub organizations, their read-only tokens, and repository import |
| Slack | `/settings/slack` | Webhook or bot token, signing secret, app credentials — and the owners alerts route to |
| Teams | `/settings/teams` | The Microsoft Teams Workflows webhook |
| Email | `/settings/email` | Provider, credential and recipients for the weekly digest |
| Desktop | `/settings/desktop` | Browser notifications for new CVEs |
| Model | `/settings/model` | The LLM provider behind the plain-English explanations |

**Batch actions.** Tick the rows and a bar appears above the table: acknowledge,
resolve, or have the model write the text. The counts come back per CVE, so
"12 acknowledged · 3 unchanged (CVE-… : Invalid transition …)" is what a mixed
selection says rather than a silent partial success. Ticking survives sorting,
but not a filter change or a new page — those are different rows, and acting on
a selection you can no longer see is how the wrong thing gets resolved.

Acknowledging in batch queues the mitigation guides rather than writing them in
the request, so the table updates immediately and the text arrives behind it.
*Explain the ones without text* fills in whatever was collected before a model
was configured; *Rewrite all explanations* does it again for everything ticked.
Progress shows above the table while the job runs, and the table reloads when it
finishes. See [queues.md](queues.md) for the job itself.

`/organizations` and `/owners` still work — they redirect to the tab that took them over.

**Authentication.** Passkeys — there is no console password. The browser proves possession of a credential, the console turns the session token the API issues into an HttpOnly cookie, and requests then go to the console's `/bff` prefix, which attaches `X-API-Key` server-side and the session token as a header. Neither reaches the page. Sign-in is throttled to 10 attempts per IP with a 15-minute lockout, and the API applies its own limits per account. [Authentication](authentication.md) covers the first account, invitations and recovery.

## CLI

A terminal client ships with the package — a live dashboard plus scriptable commands. It is an **HTTP client of the API**, with the same key the console uses: there is no database connection to hand out.

```bash
export API_KEY=...                          # the same one the API has
export ATALAIA_API_URL=http://localhost:3000  # or pass --api <url>

pnpm run build:cli       # compile to dist/ (also runs on `pnpm install`)
node bin/atalaia.js --help
pnpm run dev:cli         # run from source with tsx
```

| Command | Purpose |
|---------|---------|
| `atalaia dashboard` | Live Ink dashboard (default command). `-r, --refresh <seconds>` |
| `atalaia status` | One-shot summary. `--json` |
| `atalaia list` | Query vulnerabilities. `--source`, `--tech`, `--limit`, `--json` |
| `atalaia show <cve-id>` | Details, explanation and timeline. |
| `atalaia ack <cve-id>` | OPEN → ACKNOWLEDGED. `--actor` |
| `atalaia resolve <cve-id>` | → RESOLVED. `--actor` |
| `atalaia scan` | Queue a monitoring cycle. The worker runs it. |
| `atalaia feed list\|enable\|disable\|reset\|catalog` | Sources and the database catalog. `--all`, `--json` |
| `atalaia org add\|list\|repos\|import\|enable\|disable\|token\|remove` | Organizations and their read-only tokens. `--token`, `--only`, `--no-languages` |
| `atalaia repo add\|remove\|restore\|enable\|disable\|list\|scan\|scan-status\|deps\|tech` | Monitored repositories. `--all`, `--ecosystem`, `--refresh`, … A scan is queued, and `scan-status` follows it. `--concurrency <n>` overrides how many repositories are scanned at once, and `scan-cancel` stops a sweep. |
| `atalaia owner add\|remove\|list\|show\|assign\|unassign` | Owners and assignments. |

`--api <url>` points any command at another API; `ATALAIA_API_URL` does the same for every command. There is no `--db` any more — the CLI does not open the database.
