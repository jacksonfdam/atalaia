# Security

What Atalaia holds, who can reach it, and what it refuses to say.

Atalaia is a service with credentials to other people's systems — read tokens for source code, a bot that can message your team, a model that reads your vulnerability data. The value of the database is not the CVE list, which is public. It is the map: which organizations you have, which repositories, which dependencies, which of them are behind, and who to tell.

---

## The four credentials

| Credential | Who holds it | What it opens |
|------------|--------------|---------------|
| **Passkey** | A person's device | Which person is making a console request |
| **Session token** | An HttpOnly cookie, a row in Postgres | That person is still signed in |
| **`API_KEY`** | The console's server, the CLI | The REST API — read and write |
| **`MCP_API_KEY`** | An agent | `/mcp` only, and every tool there reads |

`API_KEY` is a machine credential. It says which *program* is calling, never which person — that is what a session is for. See [authentication.md](authentication.md) for the passkey half.

### Give agents their own key

`MCP_API_KEY` exists because the REST key can rewrite where alerts go, point the model that reads your CVE text at any endpoint, import organizations and disable feeds. No tool on `/mcp` does any of that, so no agent needs the ability to.

```bash
MCP_API_KEY=$(openssl rand -hex 32)
```

Once it is set, `/mcp` accepts only that key and the REST key stops opening `/mcp`. Left unset, `/mcp` falls back to `API_KEY` and an agent holds the keys to everything — which is the old behaviour, kept so an upgrade does not disconnect a working agent, and worth changing on the day you read this.

---

## Secrets at rest

GitHub tokens, SMTP passwords, Slack webhooks and credentials, the Telegram bot token and the LLM API key are encrypted with AES-256-GCM before they are stored, keyed from `TOKEN_ENCRYPTION_KEY` (or `API_KEY` when that is not set). Changing that key makes every stored secret unreadable.

**None of them come back out.** The API answers with a boolean and the last four characters:

```json
{ "hasToken": true, "tokenHint": "••••4f2a" }
```

There is no endpoint that returns a stored secret, in any shape, to any caller. That is checked against a running instance rather than asserted: real credentials are written through the API's own write paths, then every read endpoint and every MCP tool is fetched and searched for them.

## Secrets in the log

An error from a failed outbound call used to carry the whole request with it — headers, and for Telegram a URL with the bot token in it — because pino's error serializer copies every property an error owns and axios errors own their config. That is fixed: an outbound failure logs its method, a sanitized URL and its status, and nothing else. URLs lose their query string, where several feeds carry an API key, and token-shaped path segments are masked.

If you are running a build from before this, your logs contain credentials. Rotate them.

## Personal data

Owners have an email address, a Slack id and a Telegram chat id, because that is how an alert reaches them. The console shows them; **`/mcp` does not**. An agent asking who owns a repository gets a name and which channels reach that person — never where any of them point. Whatever an agent is told ends up in a context window, and from there wherever that model is connected.

---

## The boundaries

**The browser holds nothing.** The console's server keeps the API key and attaches it server-side. The session token lives in an HttpOnly cookie and is stripped out of every reply before it reaches the page. Nothing sensitive is in `localStorage`.

**The console reaches the REST API and nothing else.** Paths under `/bff` are resolved and checked for containment before the request goes out, so `..` — in any spelling — cannot walk out of `/api/v1` and reach, say, `/mcp` with the key attached.

**The sign-in relay serves a list.** It cannot require a session, since it is how a session comes to exist, so it forwards only the fifteen endpoints sign-in and account management need, by method and path. A prefix check there is not enough: `..` resolves back inside `/api/v1` and passes containment.

**A stale session is a rejection.** A request that carries a session token must have a live one. It is never quietly downgraded to key-only access.

**Read-only outward.** Every GitHub request goes through one GET helper, and a test fails the build if a write call appears in that file. Feeds and package registries are read, never written.

## Webhooks

| Caller | How it proves itself |
|--------|----------------------|
| Slack | HMAC-SHA256 over the raw body with the signing secret, compared in constant time, rejected beyond five minutes old |
| Telegram | The secret token it was given at registration, in a header, compared in constant time |

Telegram signs nothing, so the secret header is the whole of it — which is why the webhook URL must be https and is checked before registration.

## Rate limits

Per address in the console, which is the only process that sees the address; per account, credential or route in the API, where every request arrives from the console. Bootstrap is the tightest of them: until the first account exists it is a password prompt with no second factor. [authentication.md](authentication.md#rate-limits) has the numbers.

Both are in memory and neither survives a restart. They exist so that guessing costs time, not as the thing standing between an attacker and an account.

## Headers

The API answers JSON and says so: `default-src 'none'`, no framing, no `X-Powered-By`. The console sends a content policy that allows scripts from its own origin only.

`X-XSS-Protection` was removed rather than kept. Browsers have dropped it, and the auditor filter it enabled introduced cross-site leaks of its own.

---

## What is left, and known

**The console loads fonts from Google.** `ui/index.html` links `fonts.googleapis.com`, so a third party learns the address of every console and the IP of every operator who opens one. Self-hosting the two families would end it; the design depends on them, so it has not been done unilaterally.

**Behind a reverse proxy, set `TRUST_PROXY`.** It is off by default, which is the safe default — a service that believes `X-Forwarded-For` with no proxy in front lets any caller claim any address, defeating the per-address throttling and filling the audit log with fiction. Behind a real proxy it has to be on, or every operator shares one address and one of them failing locks out the rest.

**An LLM base URL is not restricted.** An operator can point completions at any address, including one inside your network, and that is deliberate: Ollama on the LAN is the common case. It does mean the REST key can arrange for CVE text to be sent somewhere of its choosing — one more reason agents get `MCP_API_KEY`.

**CVE text reaches the model.** Descriptions come from public feeds and are passed to whichever provider is configured. A feed could put instructions in a description; the worst that produces is a misleading explanation, since nothing acts on the output. It is still text from the internet arriving in a prompt.

**Browser-level passkey flows are not covered by tests.** The ceremonies are exercised end to end against the real verifier with a software authenticator, which covers replay, challenge reuse, expiry and counter regression. Conditional UI and the platform prompt are checked by hand.

**The rate limiters do not survive a restart or a second API container.** Stated rather than fixed: moving them into Postgres is a change with its own cost, and they are a speed bump by design.

---

## Reporting something

Open a private security advisory on the repository rather than an issue. If it involves a credential that may have been written to a log, rotate first and report second.
