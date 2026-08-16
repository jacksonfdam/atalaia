# Authentication

The console signs people in with **passkeys**. There is no shared password, no password to reset, and nothing to phish: the credential is a private key held by a device, and it only ever signs a challenge issued for one domain.

The setup password survives in exactly two places — creating the first account, and a break-glass path that is off unless you turn it on.

---

## How it fits together

| Credential | Who holds it | What it says |
|------------|--------------|--------------|
| **Passkey** | A person's device | Which person is making this request |
| **Session token** | An HttpOnly cookie in the browser, a row in Postgres | That person is still signed in, and has not been signed out |
| **API key** | The console's server, the CLI, an agent over MCP | Which program is calling |

The API key is not user authentication and never was. It says a program is allowed to talk to the API; the CLI and the MCP server still use it on its own. Console requests carry both — the key, attached by the console's server, and the session token, taken out of the cookie and sent as `X-Session-Token`.

```
browser ──cookie──▶ console :3001 ──X-API-Key──────▶ API :3000 ──▶ Postgres
                               └──X-Session-Token──┘
```

The browser never sees the API key. The page never sees the session token.

---

## The first account

On a fresh installation there are no accounts, and `./scripts/atalaia.sh up` generates a `SETUP_PASSWORD` and prints it once.

1. Open the console. It offers a form rather than a passkey prompt, because it has asked the API and been told nobody has registered yet.
2. Enter a username and the setup password. The browser prompts for a passkey.
3. Ten recovery codes are shown. **This is the only time they are shown.**

That account is an administrator. From that moment the setup password no longer grants access anywhere — the same request now answers `403`, and the flag recording it lives in the database, so restarting does not reopen the door.

Remove `SETUP_PASSWORD` from `.env` once you have signed in. Nothing needs it again unless you deliberately enable break-glass.

## Everybody else

Registration is not open. A passkey proves possession of an authenticator and says nothing about who is allowed in, so an account exists because an administrator invited it.

**Settings → People → Invite** produces a single-use link that expires in three days. The invitee opens it, registers a passkey, and gets their own recovery codes. An invitation that is never completed leaves an account with no passkeys — visible in the same table as `none yet`, and harmless: there is nothing to sign in with.

## Signing in

Two ways, both always available:

- **Autofill.** The username field offers the passkeys this device holds. Picking one signs in without typing anything.
- **The button.** *Sign in with a passkey* asks the browser directly. This is the only path that works on Windows 10 and on Firefox for Android, where autofill for passkeys does not exist.

A browser with no WebAuthn support is told so by name. There is no password fallback to offer it.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBAUTHN_RP_ID` | `localhost` | The domain the passkeys belong to. A bare domain — no scheme, no port, no path. |
| `WEBAUTHN_ORIGINS` | `http://localhost:3001` | Comma-separated, where the **console** is reached, in full. Each must be `https` unless it is loopback, and each must sit under `WEBAUTHN_RP_ID`. |
| `WEBAUTHN_RP_NAME` | `Atalaia Console` | What the browser's prompt calls this service. |
| `SETUP_PASSWORD` | — | Creates the first account. `UI_PASSWORD` is read as a fallback, for installations that predate this. |
| `SESSION_TTL_HOURS` | `720` | How long a session lasts. |
| `CHALLENGE_TTL_SECONDS` | `120` | How long a ceremony may take. |
| `WEBAUTHN_REQUIRE_UV` | `false` | Require user verification — a PIN, a fingerprint. Off by default so authenticators that cannot do it still work. |
| `AUTH_ALLOW_BREAKGLASS` | `false` | See below. Leave it off. |
| `AUTH_SWEEP_CRON` | `17 * * * *` | When spent challenges and week-old sessions are deleted. |

These are read by the **API**, and they describe the **console's** address. That is not a mistake: the ceremony happens in the browser talking to the console, and the API is what verifies it.

The API refuses to start on a value the browser would reject — an origin that is not under the relying party id, a bare `http` origin outside loopback, an `rpID` with a port in it. That failure otherwise surfaces in somebody's browser console with a message they cannot act on.

### `WEBAUTHN_RP_ID` cannot be changed

A passkey is bound to the relying party id it was registered under. Change it and every credential in existence stops working — not degraded, gone. Everyone re-enrolls, with a recovery code or an administrator's help.

Atalaia records the value in use and compares it at every boot. A change is logged as an error naming both values, but it cannot be prevented: by the time the process starts, the configuration is what it is.

Moving the console to a new domain means planning for it: keep the old one resolving, or reset every account.

---

## Losing a passkey

**Recovery codes.** Ten of them, single-use, issued when the first passkey is registered. On the sign-in screen, *Lost your passkey?* takes a username and a code and gives back a session that can do exactly one thing: enroll a passkey. It is not a login — the rest of the console answers `403` to it — and it lasts fifteen minutes.

Codes are hashed with scrypt and cannot be recovered. **Settings → Passkeys** issues a fresh set, which invalidates every code outstanding.

**An administrator.** **Settings → People → Reset passkeys** removes every credential on an account, ends its sessions and issues new recovery codes in the same action. For the laptop that is not coming back.

**Break-glass.** With `AUTH_ALLOW_BREAKGLASS=true`, the setup password can enroll a passkey for an account that already exists. It is for the case where every credential and every recovery code is gone at once, and it is a shared secret that grants console access — which is what this whole change exists to remove.

Turn it on, use it, turn it off:

```bash
# in .env
AUTH_ALLOW_BREAKGLASS=true
SETUP_PASSWORD=...            # whatever it was, or set a fresh one
```

Restart the API, sign in, enroll a passkey, then set it back to `false` and restart again. Every use writes an `auth.breakglass` row to the audit log and an error line to the log.

If everything is gone and break-glass is off, the way back is the database:

```sql
DELETE FROM settings WHERE key = 'auth.bootstrapped';
```

The next visit to the console offers the setup form again. Existing accounts are untouched; the first person to register becomes an administrator.

---

## What is recorded

Every decision, in `auth_audit_log`:

| Event | When |
|-------|------|
| `auth.bootstrapped` | The first account was created |
| `credential.registered` | A passkey was enrolled |
| `auth.succeeded` | Somebody signed in |
| `auth.failed` | A ceremony was refused — with the stage, never the reason given to the caller |
| `auth.counter_regressed` | An authenticator's signature counter went backwards |
| `credential.deleted` | A passkey was removed, including by an administrator's reset |
| `recovery.issued` / `recovery.used` | Recovery codes were created, or one was spent |
| `user.invited` | An administrator invited an account |
| `auth.breakglass` | The setup password enrolled a passkey |
| `auth.signed_out` | A session was revoked |

### The counter

Most security keys count their own use and report the number with every assertion. If that number goes **down**, two copies of the same private key are in circulation — a cloned authenticator. Atalaia refuses the sign-in, logs an error naming the account, and writes `auth.counter_regressed`.

A counter that stays at zero is not that. Synced passkeys — iCloud Keychain, Google Password Manager, 1Password — report zero forever by design, and are accepted.

---

## What a failure says

Nothing. Unknown credential, wrong signature, expired challenge, spent challenge, disabled account and unknown username all answer `401` with the same body:

```json
{ "error": "Authentication failed" }
```

Held to the same floor of latency, too: rejecting an unknown credential costs one indexed lookup while checking a bad signature costs a curve operation, and the difference is readable from outside.

The audit log records which it was. The caller is not told.

---

## Rate limits

| What | Limit | Where |
|------|-------|-------|
| Any sign-in attempt, per address | 10 per 15 minutes | Console |
| Setup password | 5 per 15 minutes | API |
| Break-glass | 5 per 15 minutes | API |
| Recovery code, per username claimed | 5 per 15 minutes | API |
| Assertions against one credential | 15 per 15 minutes | API |
| Issuing challenges | 240 per minute | API |

Per-address limiting lives in the console because that is the only process that sees the address: every request the API receives arrives from the console. The API's limits are keyed by account, credential or route instead.

Both are in memory. Neither survives a restart, and neither is what stands between an attacker and an account — that is a signature over a challenge. They exist so that guessing costs time.

---

## Sessions

A session is a row. The cookie holds an opaque 32-byte token; only its SHA-256 is stored, so a dump of the table is not a set of usable sessions.

- Signing out **revokes the row**. A copy of the cookie taken beforehand stops working too.
- A fresh session is issued on every successful ceremony; none is ever reused.
- The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` outside development.
- State-changing requests must carry `X-Atalaia-Console`, a header no cross-origin form can set.
- Revoked and expired rows are kept for a week before the sweep removes them, because *when* a session ended is a question somebody asks after an incident.

---

## Upgrading an existing installation

1. `git pull`, then rebuild: `./scripts/atalaia.sh up --build`. The migration adds the tables.
2. The console shows the setup form. Your existing `UI_PASSWORD` still works for it — the API reads either name.
3. Create your account, save the recovery codes, enroll a second passkey.
4. Remove `UI_PASSWORD` and `UI_SESSION_SECRET` from `.env`. Neither is read any more: the console signs nothing now.

Nothing else changes. The API key, the CLI, the MCP server, Slack and Telegram are all untouched — none of them ever used the console's password.
