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
| Vulnerabilities | Filter, paginate, acknowledge and resolve |
| Sources | Enable/disable each source, live per-feed health, and the full database catalog |
| Repositories | Add, enable/disable, scan, inspect technologies and parsed dependencies |
| Settings | Everything configurable, one tab at a time |

Settings is tabbed, because stacking every integration on one page made the bottom of it unreachable. Each tab has its own URL, so `/settings/slack` is a link you can send someone:

| Tab | Path | What it manages |
|-----|------|-----------------|
| General | `/settings/general` | Schedules, switches, and which environment secrets are present |
| Organizations | `/settings/organizations` | GitHub organizations, their read-only tokens, and repository import |
| Slack | `/settings/slack` | Webhook or bot token, signing secret, app credentials — and the owners alerts route to |
| Teams | `/settings/teams` | The Microsoft Teams Workflows webhook |
| Email | `/settings/email` | Provider, credential and recipients for the weekly digest |
| Desktop | `/settings/desktop` | Browser notifications for new CVEs |
| Model | `/settings/model` | The LLM provider behind the plain-English explanations |

`/organizations` and `/owners` still work — they redirect to the tab that took them over.

**Authentication.** The browser signs in against the console with `UI_PASSWORD` and receives an HMAC-signed, HttpOnly session cookie. Requests then go to the console's `/bff` prefix, which attaches `X-API-Key` server-side. The API key never reaches the browser. Sign-in is throttled to 5 failed attempts per IP, with a 15-minute lockout.

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
| `atalaia repo add\|remove\|restore\|enable\|disable\|list\|scan\|scan-status\|deps\|tech` | Monitored repositories. `--all`, `--ecosystem`, `--refresh`, … A scan is queued, and `scan-status` follows it. |
| `atalaia owner add\|remove\|list\|show\|assign\|unassign` | Owners and assignments. |

`--api <url>` points any command at another API; `ATALAIA_API_URL` does the same for every command. There is no `--db` any more — the CLI does not open the database.
