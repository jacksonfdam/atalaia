# Security policy

## Reporting

Use [private vulnerability reporting](https://github.com/jacksonfdam/atalaia/security/advisories/new) rather than an issue.

If the finding involves a credential that may have been written somewhere it should not be — a log, a response body, a database column — **rotate it first and report second**. An advisory can wait an hour; a live token cannot.

You will get an acknowledgement within a few days. This is a project maintained in evenings, not a vendor with an on-call rotation, and it is better to say that than to publish a response time nobody can keep.

## Supported versions

The latest release. There is no backport branch.

## What Atalaia holds

Worth knowing before you look for something interesting:

- **Read tokens for source code.** Per organization, AES-256-GCM at rest, never returned by the API.
- **A bot that can message your team.** Slack, Teams and Telegram credentials, same treatment.
- **A model's API key**, and the CVE text that gets sent to it.
- **The map.** Which organizations, which repositories, which dependencies, which are behind, and who to tell. The CVE list is public; this is not.

[docs/security.md](../docs/security.md) has the whole model: the four credentials, what never leaves, the boundaries between the console, the API and an agent, and the things that are known and deliberately unfixed.

## Known and deliberate

Please read that last section before reporting. Several things that look like findings are decisions:

- The LLM base URL is unrestricted, because Ollama on the LAN is the common case.
- Rate limits are in memory and do not survive a restart. They are a speed bump, not the control.
- `TRUST_PROXY` is off by default, so `req.ip` behind a proxy is the proxy.
- The console loads fonts from Google. Known, and disliked.

## If you ran a build from before 1.2.0

Failed outbound calls were logged with the whole axios error attached, which included request headers and, for Telegram, a URL with the bot token in it. **Rotate anything Atalaia holds**: GitHub organization tokens, the Telegram bot token, Slack webhooks and signing secret, SMTP credentials, and the model API key.
