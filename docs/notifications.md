# Notifications

Slack, Microsoft Teams, Discord, Telegram, desktop pop-ups and the weekly email digest. Each integration is independent: enable any, all, or none. A vulnerability is offered to each, and each decides for itself whether it is configured.

## What gets alerted

Not everything a cycle collects. Two limits stand between the feeds and a chat, and both apply to every channel:

- **Age.** An advisory published more than `VULN_MAX_AGE_DAYS` ago (seven days by default) is discarded, and so is one whose source publishes no date. Most feeds serve a catalogue rather than a window; see [Sources](sources.md).
- **Volume.** At most `MAX_ALERTS_PER_CYCLE` alerts go out per cycle, twenty by default, spaced by `ALERT_DELAY_MS`. Telegram accepts about twenty messages a minute to a group and answers the rest with `429`, and a first run against an empty database has a backlog to work through.

Past the volume cap the findings are still recorded — the console lists them, the relevance filters find them, they appear in the weekly digest. It is the message that is dropped, not the finding, and `notified_at` is null on the ones that were never announced. What they do not get is the model's short explanation, which is written on the way out.

A vulnerability is stored before any message is sent, so a worker killed halfway through a batch cannot announce the whole batch a second time on the next cycle.

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

## Discord alerts

Configured under **Settings → Discord**. In Discord: channel → *Edit Channel* → *Integrations* → *Webhooks* → *New Webhook*. Paste the URL it gives you.

Alerts arrive as an embed carrying the severity as its colour, the affected repositories, the owners and a link to the advisory — the title itself is the link. There are **no Acknowledge/Resolve buttons**, for the same reason Teams has none: components need a registered application with an endpoint Discord can call back.

An incoming webhook is bound to the channel it was created in, so there is no destination to choose. The URL is a credential (anyone holding it can post there), so it is encrypted at rest and never returned by the API. `DISCORD_WEBHOOK_URL` and `DISCORD_ENABLED` pin it from the environment.

One difference worth knowing: Discord **rejects** an over-long payload outright rather than trimming it, so a long alert would be lost rather than shortened. The embed is truncated to Discord's own limits before it is sent — 256 characters of title, 4096 of description, 1024 per field.

## Telegram alerts

Configured under **Settings → Telegram**. Two things have to be right and they fail differently: the **bot token** `@BotFather` issues, and the **chat id** the alerts go to. **Send test** posts a real message, which is the only way to find out that the bot is not in the group it is supposed to post to.

Messages carry the severity, the affected repositories, the owners and the plain-English explanation, and — unlike Teams — they carry **Acknowledge and Resolve buttons**, which run exactly what the console and the Slack buttons run.

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `TELEGRAM_ENABLED` pin it from the environment, same as everywhere else.

### Setting it up

**1. Create the bot.** In Telegram, talk to [`@BotFather`](https://t.me/BotFather): `/newbot`, give it a name and a username. It answers with a token shaped `123456789:AA…`. That token is the bot — anyone holding it can post as it — so Atalaia encrypts it at rest and never returns it.

**2. Decide where alerts go.** The chat id is a number, not a `@handle`, except for public channels:

| Destination | Chat id | The bot also needs |
|---|---|---|
| **Just you** | your own numeric id, e.g. `123456789` | you to have sent it `/start` first — a bot cannot open a conversation |
| **A group** | starts with `-100`, e.g. `-1001234567890` | to be a member of the group |
| **A channel** | `@channelname`, or the numeric id for a private one | to be an administrator of the channel |

**3. Find the id — the bot tells you.** Once the webhook is registered, send the bot any message and it answers with that chat's id, ready to paste. Every chat it hears from also appears in **Settings → Telegram** as a button that fills the field in.

That is the whole reason the bot listens to messages at all: a chat id cannot be looked up anywhere. It exists only after a conversation, which is why Telegram says "chat not found" until one has happened.

Without a webhook yet, ask [`@userinfobot`](https://t.me/userinfobot), or read it from the API:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" \
  | grep -o '"chat":{"id":[0-9-]*'
```

`getUpdates` and a registered webhook are mutually exclusive — Telegram answers `409 Conflict` while a webhook is set. Remove it first (**Settings → Telegram**, or `DELETE /api/v1/settings/telegram/webhook`), read the id, then register again.

**4. Save it.** Paste the token and the chat id in the console, tick *Send alerts to Telegram*, **Save**, then **Send test**. A message in the chat means both halves are right.

### Keeping the bot to yourself

A bot is discoverable by its `@name`, so anyone who finds it can write to it. Two things keep that harmless:

- **Atalaia only answers the configured chat.** While no chat id is saved, whoever writes gets the setup reply with their id — that is the conversation you are trying to have. Once one is saved, everything from any other chat is ignored: not remembered, not answered.
- **`@BotFather` can stop it being added to groups.** `/setjoingroups` → *Disable*. `/setprivacy` → *Enable* additionally means that, in any group it is already in, it only sees messages addressed to it.

Nothing is ever *sent* anywhere except the configured chat and, when enabled, the owners' own chats. The bot token is what would let somebody post as the bot, and that never leaves the server.

### Giving the bot a face

`@BotFather` holds the bot's identity, not Atalaia — these are one-off commands in that chat:

| Command | What it sets |
|---|---|
| `/setuserpic` | The avatar. One is provided at [`docs/site/assets/brand/telegram-bot-avatar.png`](https://github.com/jacksonfdam/atalaia/blob/main/docs/site/assets/brand/telegram-bot-avatar.png) — 512×512, drawn to survive Telegram's circular crop. |
| `/setdescription` | Shown on the empty chat, before the first message |
| `/setabouttext` | Shown on the bot's profile |
| `/setcommands` | The command menu |

Text that fits the product:

> **Description** — Atalaia watches public vulnerability feeds, filters them against the technologies you ship, and tells you which of your repositories each finding reaches. Send /start to get this chat's id.

> **About** — Vulnerability intelligence for engineering teams. Alerts with Acknowledge and Resolve, and a weekly digest.

```
start - Show this chat's id, to paste into Atalaia
```

`/start` is the only command: everything else Atalaia does happens through the buttons on an alert, or in the console.

Turning on **also message owners directly** sends the same alert to each correlated owner's own chat, on top of the main destination. Each owner needs a Telegram chat id on their record (**Settings → Slack**, where owners live) and needs to have started a conversation with the bot — for the same reason as above.

### The callback, and the tunnel

Telegram only calls an address it has been given, so the buttons do nothing until a webhook is registered. It is registered for you at boot, from whichever public URL the API has:

| Where the URL comes from | When |
|---|---|
| `PUBLIC_URL` | A real deployment. Wins over any tunnel — a hostname you own should not be replaced by a throwaway one. |
| A tunnel | Development, or wherever `TUNNEL_PROVIDER` is set. `auto` takes ngrok when `NGROK_AUTH_TOKEN` is present, and Cloudflare's quick tunnel otherwise, which needs no account at all. `none` opens nothing. |

In containers `NODE_ENV` is `production`, so no tunnel opens unless `TUNNEL_PROVIDER` says so — a public hostname is not something to hand out by accident. Set `TUNNEL_PROVIDER=cloudflared` in `.env` and `./scripts/atalaia.sh up` prints the address it got.

The registration is skipped when the URL has not changed, so a restart does not disturb a working webhook. When a development tunnel hands out a new hostname, **Register webhook** in the console points Telegram at it again.

Telegram is strict about the address, and unhelpful when it refuses one: everything it dislikes comes back as `Failed to resolve host: Name or service not known`. Atalaia checks first, so the reason names the actual problem:

| Refused | Why |
|---|---|
| `http://…` | Telegram only calls `https` |
| `localhost`, `127.0.0.1`, `192.168.x.x` | Reachable from your machine, not from the internet |
| `atalaia`, `host.docker.internal` | Container names: nothing outside the compose network can resolve them |
| Any port other than 443, 80, 88, 8443 | Telegram calls no others |

That last row is why `PUBLIC_URL` usually points at a reverse proxy rather than straight at `:3000`.

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

**A base model is not an assistant.** `qwen2.5-coder:1.5b-base`, and any other name ending in `-base`, continues text rather than answering it: ask it to explain a CVE and it writes the next paragraph of the prompt. **Test model** succeeds and flags it, because the answer arrives — it is just not a reply. Use the instruct or chat variant (`qwen2.5-coder:1.5b-instruct`, `llama3.1:8b`, `gemma4:12b`).

**A thinking model is asked not to.** Recent local models reason before answering, by default. Everything Atalaia asks for is prose — three sentences for a business reader, a guide in named sections — so the reasoning is paid for and thrown away: `gemma4:12b` spent 812 tokens and 57.7 seconds on an explanation that took 65 tokens and 6.2 seconds with thinking off, for the same answer. Ollama requests therefore carry `think: false`, which models that cannot think accept without complaint.

A test that fails now names the cause: which URL answered 404, that the key was rejected, that the model was never pulled and the `ollama pull` line to fix it, or that nothing is listening. `LLM_TIMEOUT_MS` raises the limit — 90s for Ollama, because it unloads an idle model and the cycle is hourly, so nearly every call is a cold start.
