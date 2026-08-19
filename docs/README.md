# Atalaia documentation

Published at **[atalaia-console.vercel.app](https://atalaia-console.vercel.app)** — these files are the source, rendered in the console's own chrome by `pnpm --filter atalaia-docs build`. This table is the site's navigation, so a document added here appears there.

| Document | What is in it |
|----------|---------------|
| [Running Atalaia](running.md) | The launcher, Docker, plain Node, development mode |
| [Configuration](configuration.md) | Every environment variable, `config.json`, and the precedence rules |
| [Queues](queues.md) | The jobs, the schedules, retries, and how to look inside |
| [Sources](sources.md) | The vulnerability feeds, their defaults and their health |
| [Organizations and repositories](repositories.md) | GitHub import, dependency scanning, exposure and relevance |
| [Notifications](notifications.md) | Slack, Microsoft Teams, Discord, Telegram, desktop, weekly email, LLM explanations |
| [Console and CLI](console-and-cli.md) | The management console and the terminal client |
| [Authentication](authentication.md) | Passkeys, the first account, recovery codes, and what happens when one is lost |
| [Security](security.md) | The four credentials, what never leaves, the boundaries between the console, the API and agents |
| [Correctness](correctness.md) | AI authorship, what is enforced, and what is not verified yet |
| [Architecture](architecture.md) | Layers, data flow, tech stack, development commands |
| [REST API](api.md) | Every endpoint under `/api/v1` |
| [MCP server](mcp.md) | The tools agents get at `/mcp`, and how to connect one |
| [Troubleshooting](troubleshooting.md) | Symptom → cause → fix |
