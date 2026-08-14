# Atalaia

**Proactive vulnerability intelligence for engineering teams.**

Atalaia watches 14 public vulnerability sources — NVD, CISA KEV, MITRE, GHSA, EUVD, OpenCVE, Snyk, VulDB and vendor/regional feeds — filters what they publish against the technologies you actually ship, works out which of your GitHub repositories each finding reaches, and alerts the people responsible through Slack, Microsoft Teams or email.

- **Stack-aware filtering** — only the CVEs that touch your technologies, with the rest one click away
- **Read-only GitHub import** — several organizations, each with its own token; dependencies parsed from 14 ecosystems
- **Repository correlation** — which repository a CVE lands in, and through which manifest file
- **Slack-native triage** — Block Kit alerts with Acknowledge/Resolve buttons
- **Weekly executive report** — severity-grouped HTML email
- **Optional plain-English explanations** — local (Ollama, LM Studio) or hosted models
- **Management console and CLI** — a React console on port 3001 and an Ink terminal dashboard

Atalaia only ever reads: it never opens a pull request, never edits a manifest and never gates a build.

## Install and run

Requires Docker with Compose v2, or Node.js 24+ with pnpm 11+ (`corepack enable`).

```bash
git clone https://github.com/jacksonfdam/atalaia.git
cd atalaia

./scripts/atalaia.sh up
```

That single command is the whole setup. It creates `.env` from `.env.example` if it is missing, generates the secrets that have no sensible default (`API_KEY`, `UI_SESSION_SECRET`, `UI_PASSWORD`), starts the API and the management console, and waits until both answer their health endpoints. It uses Docker when the daemon is running and falls back to local Node processes when it is not.

```
  API      http://localhost:3000        (health: /health)
  Console  http://localhost:3001        (password: UI_PASSWORD in .env)
```

A first monitoring cycle runs immediately, so there is data within a minute. Slack, Teams, email and LLM summaries stay off until you fill in their credentials.

```bash
./scripts/atalaia.sh status     # health of both services
./scripts/atalaia.sh logs api   # follow logs
./scripts/atalaia.sh down       # stop everything
```

Other ways to run it — Docker Compose by hand, plain Node processes, hot-reload development — are in [docs/running.md](docs/running.md).

## Documentation

Everything else lives in [`docs/`](docs/README.md): [running](docs/running.md), [configuration](docs/configuration.md), [sources](docs/sources.md), [repositories](docs/repositories.md), [notifications](docs/notifications.md), [console and CLI](docs/console-and-cli.md), [architecture](docs/architecture.md), [REST API](docs/api.md) and [troubleshooting](docs/troubleshooting.md).

Longer-form guides are in the [GitHub Wiki](https://github.com/jacksonfdam/atalaia/wiki).

## Credits

**Created by [Jackson Mafra](https://github.com/jacksonfdam)** — Mobile and Security Engineer.

Built from the ground up starting September 2025 — from initial concept through architecture, feed integration, Slack workflows, email reporting and LLM-powered intelligence — a solo effort to give engineering teams the vulnerability visibility they deserve.

## License

MIT — see [LICENSE](LICENSE).
