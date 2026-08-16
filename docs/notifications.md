# Notifications

Slack, Microsoft Teams, Telegram, desktop pop-ups and the weekly email digest. Each integration is independent: enable any, all, or none. A vulnerability is offered to each, and each decides for itself whether it is configured.

## Slack alerts

Configure delivery under **Settings → Slack**. Two integrations, because they can do different things:

| Mode | What it can do | What it needs |
|------|----------------|---------------|
| Incoming webhook | Posts to the one channel the webhook was created for. Slack ignores any other destination. | The `https://hooks.slack.com/services/…` URL |
| Bot token | Posts to any channel the bot is in, and can direct-message a person | `xoxb-…` with `chat:write` (plus `chat:write.public` for public channels it has not joined) |

In bot mode the destination is a channel (`#security` or its `C…` ID) or a person (their `U…` member ID, which opens a direct message). Turning on **direct-message the owners** additionally DMs whoever the vulnerability correlates to, using the Slack member ID on each owner — owners without one are skipped, and a webhook cannot do this at all.

The whole Slack app fits in that one section — webhook URL or bot token, signing secret, app-level token and app ID. Credentials are encrypted at rest and never returned by the API. **Send test** posts a real message so you can confirm the destination before the next cycle.

| Field | What it is for |
|-------|----------------|
| Webhook URL / bot token | Sending the alert |
| Signing secret | Verifying the Acknowledge and Resolve clicks Slack sends back |
| App-level token + app ID | Development only: repointing the app's Request URL at the current tunnel |

Alerts carry the affected repositories and owners when correlation finds any.

Environment variables still win, field by field: `SLACK_WEBHOOK_URL` pins where alerts go, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` and `SLACK_APP_ID` pin their own fields, and `SLACK_ENABLED=false` forces delivery off wherever it is configured. A pinned field is shown as read-only rather than silently ignored.

## Desktop notifications

**Settings → Desktop** is the fallback for when Slack is not delivering. Allow notifications once and the console raises a native pop-up per new CVE — clicking one opens it.

It needs the console open in a tab, since a closed tab runs no code; for alerts that arrive with the browser shut, use Slack or the weekly email.

## Microsoft Teams alerts

The second chat integration, configured under **Settings → Teams**. In Teams: channel → *Workflows* → "Post to a channel when a webhook request is received". Paste the URL it gives you.

Alerts arrive as an Adaptive Card carrying the severity, the affected repositories, the owners and a link to the advisory. There are **no Acknowledge/Resolve buttons**: those need a registered app with an endpoint Teams can call back, which is what Slack's signing secret gives us for free.

A workflow webhook is bound to the channel it was created in, so there is no destination to choose — one webhook, one channel. The URL is a credential (anyone holding it can post there), so it is encrypted at rest and never returned by the API. `TEAMS_WEBHOOK_URL` and `TEAMS_ENABLED` pin it from the environment, same as everywhere else.

## Telegram alerts

Configured under **Settings → Telegram**. Two things have to be right and they fail differently: the **bot token** `@BotFather` issues, and the **chat id** the alerts go to — a group (`-100…`), a channel (`@name`) or a person's own chat. **Send test** posts a real message, which is the only way to find out that the bot is not in the group it is supposed to post to.

Messages carry the severity, the affected repositories, the owners and the plain-English explanation, and — unlike Teams — they carry **Acknowledge and Resolve buttons**, which run exactly what the console and the Slack buttons run.

Turning on **also message owners directly** sends the same alert to each correlated owner's own chat. An owner needs a Telegram chat id on their record, and needs to have started a conversation with the bot: a bot cannot open one.

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `TELEGRAM_ENABLED` pin it from the environment, same as everywhere else.

### The callback, and the tunnel

Telegram only calls an address it has been given, so the buttons do nothing until a webhook is registered. It is registered for you at boot, from whichever public URL the API has:

| Where the URL comes from | When |
|---|---|
| `PUBLIC_URL` | A real deployment. Wins over any tunnel — a hostname you own should not be replaced by a throwaway one. |
| A tunnel | Development, or wherever `TUNNEL_PROVIDER` is set. `auto` takes ngrok when `NGROK_AUTH_TOKEN` is present, and Cloudflare's quick tunnel otherwise, which needs no account at all. `none` opens nothing. |

In containers `NODE_ENV` is `production`, so no tunnel opens unless `TUNNEL_PROVIDER` says so — a public hostname is not something to hand out by accident. Set `TUNNEL_PROVIDER=cloudflared` in `.env` and `./scripts/atalaia.sh up` prints the address it got.

The registration is skipped when the URL has not changed, so a restart does not disturb a working webhook. When a development tunnel hands out a new hostname, **Register webhook** in the console points Telegram at it again.

There is no request signature to verify: Telegram signs nothing. What it offers instead is a secret token, chosen at registration and returned in a header on every callback. Atalaia generates one, stores it encrypted, and compares it in constant time — and a configuration with no stored secret accepts nothing rather than accepting everything.

The console shows what Telegram itself reports about the webhook, including its **last delivery error**. That is the only place a webhook that quietly stopped working ever says so.

## Subscribing to a repository

A vulnerability that reaches a repository is emailed to the people who asked about it, the moment it is detected. A dependency that fell behind is not an incident — a freshness check can mark dozens at once — so those wait for that subscriber's weekly digest.

There is no separate subscriber list: **an owner assigned to a repository is the subscription**. The same rows Slack already direct-messages, so there is one answer to "who cares about this repository" rather than two that drift apart.

Subscribe from the repository's own page, under **NOTIFY.CFG**: pick an owner and press Subscribe. Owners themselves are managed under **Settings → Slack**, where the Slack member id and the Telegram chat id also live.

| What happens | When | Where it goes |
|---|---|---|
| A CVE reaches a subscribed repository | immediately, in the cycle that found it | one email per subscriber, naming the repositories of theirs it reaches and the manifest file it arrives through |
| A dependency falls behind its registry | the weekly digest | that subscriber's digest, scoped to their repositories — by email, and in their Telegram chat if they have one |

One email per person per finding, however many of their repositories it reaches: a CVE in a package six of your repositories share is one problem, not six.

## Weekly email report

Every Monday at 09:00 (`WEEKLY_REPORT_CRON`) Atalaia emails a digest of **what it detected in the last seven days**, with the running total of everything still open shown alongside it. A quiet week reads as "nothing new, 113 open" instead of re-sending the whole backlog. Unrated findings — Ubuntu USN and the CERT feeds publish no CVSS — get their own bucket rather than being dropped.

It is split the way the console splits it, because a report that disagrees with the screen is worse than no report:

| Section | What is in it |
|---------|---------------|
| **Affects your code** | The CVE names a dependency of a tracked, enabled repository. Grouped by repository, each finding with the dependency and manifest file it arrives through, and a short explanation. |
| **Containers & CI only** | It reaches a container image, a GitHub Action, Terraform or Helm — not application code. Capped at 25 rows, with the full count. |
| **Everything else collected** | Published somewhere, naming nothing this fleet ships. Capped at 25 rows: this is thousands on a real install, and an email that lists them is a database dump. |
| **Dependencies behind** | Per repository, where the registry has a newer release than the manifest allows. |

The short explanation is the model's when one is configured (**Settings → Model**), otherwise the advisory text trimmed to a paragraph — the same fallback the Slack alert uses.

The header states both numbers a reader might be looking for: what arrived this week, and what is still open. The console's *Affects our code* count folds containers and CI in, so it equals this report's first two sections added together.

**Reading it without waiting for Monday:** the console's **Reports** page renders exactly this payload — `GET /api/v1/reports/weekly`, the same one the email is built from — with a *Send now* button beside it.

The same report goes to Telegram when it is configured — the numbers, the repositories reached, and what fell behind, capped per section with the totals stated so what is cut off is still counted.

Pick a provider under **Settings → Email**, fill in its credential, and save:

| Provider | What it asks for |
|----------|------------------|
| Mailtrap | Host (sandbox or live), port, username, password |
| Mailjet | API key (as the username) and secret key |
| SendGrid | API key — the username is the literal string `apikey` |
| Mailgun | SMTP host (US or EU), SMTP login, password |
| MailerLite | Username and password |
| Resend | API key — the username is the literal string `resend` |
| Custom SMTP | Host, port, username, password |

All of them are reached over SMTP through nodemailer rather than six REST SDKs: every provider here offers SMTP with the same credentials its API uses, and one transport means one code path to keep working.

The credential is encrypted at rest with `TOKEN_ENCRYPTION_KEY` (or `API_KEY`) and never returned by the API — the console shows only its last four characters. Two buttons check the setup without waiting for Monday: **Test connection** opens the SMTP session and authenticates without sending, and **Send test** delivers the current digest to the configured recipients.

```bash
curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/settings/email

curl -X PUT -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"provider":"resend","secret":"re_…","from":"atalaia@example.com",
       "recipients":"security@example.com","enabled":true}' \
  http://localhost:3000/api/v1/settings/email

curl -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"send":false}' http://localhost:3000/api/v1/settings/email/test
```

Manual email testing notes live in [`../tests/README-EMAIL-TESTING.md`](../tests/README-EMAIL-TESTING.md).

## Plain-English explanations

Atalaia can attach a short explanation to each vulnerability — what it means for someone who does not read CVSS vectors for a living. It is **optional**: with no model configured, alerts carry the advisory text as published and nothing else changes.

Pick one under **Settings → Model**. The split that matters is not the brand:

| | Providers | What it means |
|---|---|---|
| **Local** | Ollama, LM Studio | Runs on this machine. No vulnerability text leaves the network. |
| **Hosted** | OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, any OpenAI-compatible endpoint | The title and description of every vulnerability explained are sent to that vendor. |

The console says which one is selected in as many words, because sending your security findings to a third party is a decision, not a default. A local provider needs no key; a hosted one does, and it is encrypted at rest and never returned by the API. **Test model** sends one short prompt and shows the answer, so a wrong endpoint or model name surfaces immediately instead of at 3am.

Everything except Anthropic speaks the OpenAI chat-completions shape — Gemini included, through Google's OpenAI-compatible surface — so `custom` covers vLLM, LiteLLM, Vertex AI behind a proxy, or a gateway of your own: give it a base URL and a model name.

The explanation is written once, when the vulnerability is first stored, and travels with the Slack alert and the weekly report. Changing provider takes effect on the next cycle; there is no restart.

Anything collected before a model was configured therefore has none. **Explain**, on the CVE's page, writes it on demand — and rewrites it, if a better model is configured since.

```bash
curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/settings/llm

curl -X PUT -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"provider":"ollama","model":"llama3.1","enabled":true}' \
  http://localhost:3000/api/v1/settings/llm

curl -X POST -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/settings/llm/test
```

### The endpoint, and two things that look like a broken model

**Paste whatever URL you have.** Providers disagree about the path: Ollama serves `/api/generate` off the base, the OpenAI shape wants `/v1/chat/completions`, Gemini versions it as `/v1beta/openai`. Atalaia normalises the endpoint to the base each provider needs, so `http://localhost:11434/v1/chat/completions` and `http://localhost:11434` behave identically. The corrected value is what gets stored the next time you save.

**`localhost` from inside a container is the container.** Atalaia runs in containers, so a model on the host is not at `localhost` from its point of view. When a loopback address refuses the connection, the request is retried against `host.docker.internal` — nothing to configure, and it works the same under Docker and Apple's runtime.

**A base model is not an assistant.** `qwen2.5-coder:1.5b-base`, and any other name ending in `-base`, continues text rather than answering it: ask it to explain a CVE and it writes the next paragraph of the prompt. **Test model** succeeds and flags it, because the answer arrives — it is just not a reply. Use the instruct or chat variant (`qwen2.5-coder:1.5b-instruct`, `llama3.1:8b`).

A test that fails now names the cause: which URL answered 404, that the key was rejected, that the model was never pulled and the `ollama pull` line to fix it, or that nothing is listening. `LLM_TIMEOUT_MS` raises the 30s limit for a large model on a cold start.
