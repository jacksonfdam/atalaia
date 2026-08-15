# Atalaia

**Proactive vulnerability intelligence for engineering teams.**

Atalaia watches 14 public vulnerability sources — NVD, CISA KEV, MITRE, GHSA, EUVD, OpenCVE, Snyk, VulDB and vendor/regional feeds — filters what they publish against the technologies you actually ship, works out which of your GitHub repositories each finding reaches, and alerts the people responsible through Slack, Microsoft Teams or email.

- **Stack-aware filtering** — only the CVEs that touch your technologies, with the rest one click away
- **Read-only GitHub import** — several organizations, each with its own token; dependencies parsed from 12 ecosystems
- **Repository correlation** — which repository a CVE lands in, and through which manifest file
- **Slack-native triage** — Block Kit alerts with Acknowledge/Resolve buttons
- **Weekly executive report** — severity-grouped HTML email
- **Optional plain-English explanations** — local (Ollama, LM Studio) or hosted models
- **Management console and CLI** — a React console on port 3001 and an Ink terminal dashboard
- **MCP server for agents** — twelve tools at `/mcp`, all reads bar the one that asks a model for an explanation
- **Durable jobs** — feed cycles, scans and freshness checks run in a worker, queued in Postgres

Atalaia only ever reads: it never opens a pull request, never edits a manifest and never gates a build.

## Install and run

Atalaia runs in containers: Docker with Compose v2, or Apple's `container` on macOS 15+. Its database is **Supabase** — the local stack in development, a cloud project in production — and the [Supabase CLI](https://supabase.com/docs/guides/cli) brings the local one up.

```bash
git clone https://github.com/jacksonfdam/atalaia.git
cd atalaia

supabase start                  # Postgres, locally
./scripts/atalaia.sh up
```

Put the connection string `supabase start` prints into `.env` as `DATABASE_URL` (this repository's local stack is on port 54622). Everything else the launcher handles: it creates `.env` from `.env.example` if it is missing, generates the secrets that have no sensible default (`API_KEY`, `UI_SESSION_SECRET`, `UI_PASSWORD`), applies the migrations, starts the three containers and waits until they answer.

```
  API      http://localhost:3000        (health: /health)
  Console  http://localhost:3001        (password: UI_PASSWORD in .env)
  Worker   no port — it takes jobs off the queue
```

Slack, Teams, email and LLM summaries stay off until you fill in their credentials.

```bash
./scripts/atalaia.sh status              # health of each service
./scripts/atalaia.sh logs atalaia-worker # follow the worker
./scripts/atalaia.sh doctor              # runtime, database, configuration
./scripts/atalaia.sh down                # stop everything
```

Apple's runtime, scaling the worker, and developing against the stack are in [docs/running.md](docs/running.md).

## Documentation

The same pages, rendered: **[atalaia-console.vercel.app](https://atalaia-console.vercel.app)**.

Everything else lives in [`docs/`](docs/README.md): [running](docs/running.md), [configuration](docs/configuration.md), [queues](docs/queues.md), [sources](docs/sources.md), [repositories](docs/repositories.md), [notifications](docs/notifications.md), [console and CLI](docs/console-and-cli.md), [architecture](docs/architecture.md), [REST API](docs/api.md), [MCP server](docs/mcp.md) and [troubleshooting](docs/troubleshooting.md).

## Credits

**Created by [Jackson Mafra](https://github.com/jacksonfdam)** — Mobile and Security Engineer. Built and maintained solo since September 2025.

## License

MIT — see [LICENSE](LICENSE).
