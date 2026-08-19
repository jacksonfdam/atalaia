# Atalaia

[![CI](https://github.com/jacksonfdam/atalaia/actions/workflows/ci.yml/badge.svg)](https://github.com/jacksonfdam/atalaia/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 24+](https://img.shields.io/badge/node-24%2B-brightgreen.svg)](package.json)
[![Self-hosted](https://img.shields.io/badge/self--hosted-no%20telemetry-informational.svg)](docs/security.md)

**Atalaia tells you whether a CVE actually reaches you.**

For maintainers with more repositories than attention. It watches fifteen public vulnerability feeds, filters them against the technologies you ship, works out which of your repositories each finding lands in and through which manifest file, and tells the person who owns it — in Slack, Teams, Discord, Telegram or email.

It reads. It never opens a pull request, never edits a manifest, never gates a build, and never phones home.

<!-- TODO(demo): fifteen seconds — a Slack alert arriving, Acknowledge pressed, the row
     going quiet. Record at 1200px, keep it under 3MB, drop it in docs/site/assets/. -->

## Why not Dependabot

Because you should run both. They answer different questions.

| | What it answers | What it does about it |
|---|---|---|
| **Dependabot / Renovate** | Is a newer version available? | Opens pull requests |
| **Trivy / Grype** | Does this image or tree contain a known-vulnerable package? | Fails the scan |
| **OSV-Scanner** | Does this lockfile match the OSV database? | Prints a list |
| **Atalaia** | A CVE was published this morning — does it reach anything I run, who owns that, and what does it actually mean? | Tells a person, and remembers what they decided |

The others start from your code and look outward. Atalaia starts from the feed and looks inward: it is watching the stream of everything published, not the contents of your lockfile, and the work it does is deciding which of that stream is yours. Dependabot will not tell you at 09:00 that the thing on Hacker News touches four of your services. Atalaia will not upgrade them for you.

The rest of the difference is disposition. It is read-only by construction, it runs on your hardware, it holds no telemetry, and when it does not know something it says so — a feed returning nothing is `EMPTY`, not healthy; a version it cannot compare is `unknown` with a reason; a repository nobody has scanned says so rather than reading as clean.

## What it does

- **Stack-aware filtering** — the CVEs that touch your technologies, with the rest one click away
- **Read-only GitHub import** — several organizations, each with its own token; dependencies parsed from 12 ecosystems
- **Repository correlation** — which repository a CVE lands in, and through which manifest file
- **Triage where you already are** — Slack Block Kit and Telegram, both with Acknowledge and Resolve buttons
- **Weekly digest** — severity-grouped, by email and to a chat
- **Plain-English explanations** — optional, from a local model (Ollama, LM Studio) or a hosted one
- **Console and CLI** — a React console and an Ink terminal dashboard
- **Twelve tools for agents** at `/mcp`, all reads bar the one that asks a model for an explanation, behind a key of their own
- **Durable jobs** — feed cycles, scans and freshness checks in a worker, queued in Postgres
- **Passkeys** — no shared console password, with recovery codes

## Is this AI slop?

Most of Atalaia was written by a language model under my direction, and I would rather you heard that from me than worked it out from the commit history. For a lot of projects that is a footnote. For a vulnerability scanner it is not: one that quietly misses things is worse than none at all, because it replaces "I do not know what I am exposed to" with false confidence.

So the useful question is not whether a model typed the code. It is what stops the output from being wrong.

**Nothing that decides is generated.** Severity, CVSS, exploited status and advisory links are read from the feed and stored as they arrived. No model ranks, scores, filters or de-duplicates anything. A model is asked for three things, all of them prose, all of them after triage — `grep -rln "createLLMAdapter" src/` returns four files, and the fourth is the adapter. Which prose appears where — the model's, or the advisory's own words when no model is configured — is decided in one definition every channel reads.

**Read-only is enforced, not promised.** A test greps the GitHub provider for write calls and asserts every request goes through the single GET helper, so no future method can route around it.

**I read all of it,** slowly, and more than once for anything in the correlation path. Any mistakes left in the codebase are mine.

That is the honest list, and it is shorter than I would like. Correlation currently matches CVEs to repositories by package name rather than by advisory version range; most parsers are untested. Both are written up, with the rest of what I do not claim, in **[docs/correctness.md](docs/correctness.md)** — along with the commands to check any of it yourself.

## Run it

Containers: Docker with Compose v2, or Apple's `container` on macOS 15+. One Postgres, anywhere you like.

```bash
git clone https://github.com/jacksonfdam/atalaia.git
cd atalaia

docker run -d --name atalaia-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17
echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres" >> .env

./scripts/atalaia.sh up
```

Ten seconds to a working console once the images are built, and about the same again to build them. The launcher creates `.env` from `.env.example`, generates the secrets that have no sensible default (`API_KEY`, `SETUP_PASSWORD`), applies the migrations, starts the three containers and waits until they answer.

```
  API      http://localhost:3000        (health: /health)
  Console  http://localhost:3001        (sign in with a passkey)
  Worker   no port — it takes jobs off the queue
```

Any Postgres 13+ works: a container like the one above, a managed instance, or a local **Supabase** stack (`supabase start`, this repository's is on port 54622) if you want the studio alongside it. Atalaia uses none of Supabase's own features — it needs a connection string.

The console has no password. `SETUP_PASSWORD` creates the first account and stops working the moment it has; from then on it is passkeys, with recovery codes for the day a device is lost — [docs/authentication.md](docs/authentication.md).

Slack, Teams, Discord, Telegram, email and model explanations all stay off until you configure them, from the console.

```bash
./scripts/atalaia.sh status              # health of each service
./scripts/atalaia.sh logs atalaia-worker # follow the worker
./scripts/atalaia.sh doctor              # runtime, database, configuration
./scripts/atalaia.sh down                # stop everything
```

Apple's runtime, scaling the worker, and developing against the stack are in [docs/running.md](docs/running.md).

## Documentation

The same pages, rendered: **[atalaia-console.vercel.app](https://atalaia-console.vercel.app)**.

Everything else lives in [`docs/`](docs/README.md): [running](docs/running.md), [configuration](docs/configuration.md), [authentication](docs/authentication.md), [security](docs/security.md), [correctness](docs/correctness.md), [queues](docs/queues.md), [sources](docs/sources.md), [repositories](docs/repositories.md), [notifications](docs/notifications.md), [console and CLI](docs/console-and-cli.md), [architecture](docs/architecture.md), [REST API](docs/api.md), [MCP server](docs/mcp.md) and [troubleshooting](docs/troubleshooting.md).

## Contributing

A new feed, ecosystem, notification channel or model provider is one file and one line in a registry. [CONTRIBUTING.md](CONTRIBUTING.md) has the shape of the codebase and the four things it will not do.

Security issues go through [private reporting](.github/SECURITY.md), not an issue.

## Credits

**Created by [Jackson Mafra](https://github.com/jacksonfdam)** — Mobile and Security Engineer. Built and maintained solo since September 2025.

## License

MIT — see [LICENSE](LICENSE).
