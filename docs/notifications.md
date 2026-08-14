# Notifications

Slack, Microsoft Teams, desktop pop-ups and the weekly email digest. Each integration is independent: enable any, all, or none. A vulnerability is offered to each, and each decides for itself whether it is configured.

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
| App-level token + app ID | Development only: repointing the app's Request URL at the current ngrok tunnel |

Alerts carry the affected repositories and owners when correlation finds any.

Environment variables still win, field by field: `SLACK_WEBHOOK_URL` pins where alerts go, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` and `SLACK_APP_ID` pin their own fields, and `SLACK_ENABLED=false` forces delivery off wherever it is configured. A pinned field is shown as read-only rather than silently ignored.

## Desktop notifications

**Settings → Desktop** is the fallback for when Slack is not delivering. Allow notifications once and the console raises a native pop-up per new CVE — clicking one opens it.

It needs the console open in a tab, since a closed tab runs no code; for alerts that arrive with the browser shut, use Slack or the weekly email.

## Microsoft Teams alerts

The second chat integration, configured under **Settings → Teams**. In Teams: channel → *Workflows* → "Post to a channel when a webhook request is received". Paste the URL it gives you.

Alerts arrive as an Adaptive Card carrying the severity, the affected repositories, the owners and a link to the advisory. There are **no Acknowledge/Resolve buttons**: those need a registered app with an endpoint Teams can call back, which is what Slack's signing secret gives us for free.

A workflow webhook is bound to the channel it was created in, so there is no destination to choose — one webhook, one channel. The URL is a credential (anyone holding it can post there), so it is encrypted at rest and never returned by the API. `TEAMS_WEBHOOK_URL` and `TEAMS_ENABLED` pin it from the environment, same as everywhere else.

## Weekly email report

Every Monday at 09:00 (`WEEKLY_REPORT_CRON`) Atalaia emails a digest of **what it detected in the last seven days**, with the running total of everything still open shown alongside it. A quiet week reads as "nothing new, 113 open" instead of re-sending the whole backlog. Unrated findings — Ubuntu USN and the CERT feeds publish no CVSS — get their own bucket rather than being dropped.

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

```bash
curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/settings/llm

curl -X PUT -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"provider":"ollama","model":"llama3.1","enabled":true}' \
  http://localhost:3000/api/v1/settings/llm

curl -X POST -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/settings/llm/test
```
