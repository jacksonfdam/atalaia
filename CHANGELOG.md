# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org): a
minor bump adds capability, a patch bump only fixes.

Every entry says what changed and, where it matters, what it was doing wrong before — a
changelog that only lists additions hides the half of the work that mattered most.

## 1.3.0

A report for the question the digest does not answer — what the fleet is made of
and how far behind it is — and the printing it turned out nobody had ever tried.

### The dependency report

**`GET /reports/dependencies`, on the Reports page and on each repository's own
*Report* tab.** The weekly digest answers what was published this week that
reaches us. This answers the question asked the other way round: what do we
depend on, how much of it has moved on without us, and which languages and
ecosystems is that spread across.

It keeps four version states apart rather than three. A dependency nobody has
compared with a registry is `unchecked` — unknown, not up to date — and folding
those into "current" is what would turn every percentage on the page into a claim
nobody verified. Alongside them the report names the repositories nobody has
scanned, says how old the newest registry answer is, and explains the pins it
cannot compare instead of dropping them.

Packages behind are grouped across repositories and ranked by how many they
reach: one upgrade that clears nine repositories is a different piece of work
from nine unrelated ones. Technologies stay two independent signals — languages
from the hosting provider, ecosystems from the manifests a scan found — because a
repository can report TypeScript and carry its risk in a Dockerfile.

One endpoint, one shape, two places to read it, so the fleet view and a
repository's own cannot drift apart.

### Printing

**Ctrl+P cut the page, and two of the causes lost content rather than looking
wrong.** `.table-scroll` scrolls sideways and the dependency tables cap their
height inline; a printer does neither. Measured at a 700px page, the dependency
table wanted 954px of width inside a 630px box and 1511px of height inside 384px
— five columns and three quarters of the rows were absent from the paper. Print
now has its own layout: one column, no navigation or buttons, nothing clipped, a
fixed table layout so no column can push past the sheet, headers repeated on
every page a table spills onto, and rows that do not split down the middle.

The window titlebar is absolutely positioned, so it landed on top of the rows
when a window broke across pages; in print it sits in the flow. Titlebars and
table headers are white text on a coloured background, which disappears entirely
when Chrome drops background graphics — its default — so those print black on
white, and colour is forced only where it is the information: severity badges and
the bars.

### Fixes

- **The bar charts never had a fill.** `.bar-fill` is a span, and width and
  height do not apply to an inline box, so every bar — Overview, feed health, the
  new report — measured 0x0 and drew an empty track. The track showed because it
  is a grid item and grid items are blockified; its child is not.

## 1.2.0

Dependency coverage went from 14 of the 61 manifest and lock files people actually commit to 58,
and the test suite stopped failing at random.

### Lockfiles

**Nothing was reading lockfiles.** Every parser read a manifest, which declares a *constraint*:
`^4.17.0` does not say whether the installed copy is 4.17.11, which is vulnerable to
CVE-2021-23337, or 4.17.21, which is not. Sixteen lockfiles are read now.

| Ecosystem | Files |
|---|---|
| npm family | `package-lock.json` (schema 1 and 2/3), `npm-shrinkwrap.json`, `pnpm-lock.yaml` (v5–v9), `yarn.lock` (classic and Berry), `bun.lock` |
| Python | `poetry.lock`, `uv.lock`, `pdm.lock`, `Pipfile.lock` |
| Others | `composer.lock`, `Gemfile.lock`, `Cargo.lock`, `go.sum`, `packages.lock.json`, `packages.config`, `paket.lock`, `gradle.lockfile`, `mix.lock`, `rebar.lock`, `pubspec.lock`, `Chart.lock`, `conan.lock`, `cabal.project.freeze`, `stack.yaml.lock`, `opam.locked`, `Cartfile.resolved`, `conda-lock.yml` |

**A lockfile now supersedes the manifest beside it.** A dependency is unique on repository,
ecosystem, name and manifest file, so a repository holding both `package.json` and
`package-lock.json` stored `lodash` twice — once as `^4.17.0` and once as `4.17.21`. Every count
doubled and the Dependencies tab listed the package twice with two different verdicts. The rule is
scoped by directory, so a monorepo's `apps/a` and `apps/b` keep their own rows while a workspace's
root lockfile answers for `packages/*/package.json`. A package the lockfile does not list keeps its
manifest row: an out-of-date lockfile must not make a dependency vanish.

**When a lockfile holds the same package twice, the lower version wins.** This is ordinary, not an
edge case — `rust-lang/cargo`'s own lockfile has 23 crates at two or three versions each. If 1.3.2
is vulnerable and 2.13.0 is patched, keeping the newer one turns a real exposure into a row that
reads as clean. The reverse error is one you can see and answer.

### New ecosystems

Dart and Flutter, Helm, Elixir and Erlang, C and C++ (Conan and vcpkg), Haskell, OCaml, Zig, Lua,
Conda, Carthage, sbt and Ivy. Nine new `Ecosystem` entries, and version lookups against pub.dev,
hex.pm and Hackage.

Three ecosystems had been declared and never produced — `SWIFT`, `COCOAPODS`, `PUB` and `HELM`. The
Helm one was visible: the console's *Containers & CI only* filter and the weekly digest both counted
`HELM`, so they offered a category no row could ever match.

Conda is its own ecosystem rather than pip, because the names disagree — `pytorch` on conda-forge is
`torch` on PyPI — and filing one as the other would send every lookup and every correlation to the
wrong package.

### `pyproject.toml`

It was matched but barely read: one regular expression for `[project] dependencies`, and then every
entry stored with a **null version**, discarding the constraint it had just read. Poetry below 2.0
writes no `[project]` table at all, so a Poetry project scanned as **empty**. Now read: PEP 621,
extras, PEP 735 `[dependency-groups]` as `uv` writes them, and the Poetry, PDM and Hatch tables.
Python names are normalised per PEP 503, without which a lockfile row could not supersede a manifest
one.

### Sources

**Debian security advisories**, off by default like the other vendor sources. Read from the `DSA` and
`DLA` lists rather than `tracker/data/json`: that endpoint is a status database, not a feed — 85.9 MB,
15.2 seconds, and no publication date anywhere, so every item would have been discarded.

**A source that was never called no longer reports as empty.** OpenCVE and CVE Details both showed
`EMPTY` with the detail "Source responded but returned no vulnerabilities". Neither had responded:
both return an empty array without making a request when their credentials are missing. The status is
`NOT_CONFIGURED` now, naming the setting.

**NVD's 503 is a rate limit, not an outage.** NVD allows five requests per rolling thirty seconds
without a key and refuses the rest with 403 or 503, never 429. `NVD_API_KEY` is sent when set, and
both statuses say what they are.

### Notifications

**Discord**, under Settings → Discord. An incoming webhook and an embed, with the severity as its
colour and the affected repositories as fields. No Acknowledge/Resolve buttons, for the same reason
Teams has none. The embed is truncated to Discord's limits before it is sent, because Discord rejects
an over-long payload outright rather than trimming it.

### The test suite

**It was failing about one run in eight, on a different test each time.** supertest starts a server
for every single request — `app.listen(0)` and a close when the request ends — which across 1190
tests in eleven workers is thousands of bind-and-close cycles per run. A port that has just been
released still has the previous connection in `TIME_WAIT`, Node binds with `SO_REUSEADDR` anyway, and
a stray packet reaches the new server, so the client reads something that is not a response to it.
Each suite now binds one port and keeps it: **0 failures in 26 runs**, against 3 in 8 before.

The migration advisory lock was keyed per database rather than per schema, so eleven workers queued
twenty-two acquisitions on one key — six suites waiting at once, measured. **The full suite went from
44–47 seconds to 21.** That was the obvious suspect and it was not the cause; the commit says so.

`tests/email.test.js` exercised a database path with no database, logging "Failed to read email
configuration" on every run and passing anyway, with its behaviour depending on whatever `SMTP_*`
variables were in the developer's environment.

### Alerting

**Old CVEs stopped being announced as new.** CISA KEV serves its whole list on every fetch — 1670
items back to 2021 — and the feeds were substituting today's date for a missing one. Advisories are
now filtered by publication date (`VULN_MAX_AGE_DAYS`, seven days), an undated advisory is discarded
rather than dated to now, and a cycle sends at most 20 alerts with a pause between them.

**Batch actions** on the vulnerabilities table: select rows to acknowledge or resolve together, and
generate explanations for a selection as a background job.

**Model answers are stored as answers.** The "written by a model" label, the "Certainly! Here's an
explanation…" preamble, a leading `---`, a fence around the whole reply and a restated title all come
off, and a reply with no words in it is stored as nothing rather than as text.

**Ollama is asked for the answer, not the reasoning.** `think: false` took a 12B model from 57.7
seconds to 6.2 for the same paragraph.

### Fixes

- A killed batch no longer blocks its queue for an hour.
- `jobs.js` is the queue definition on every boot, not only the first.
- The weekly digest reported the entire open backlog, because every row's date failed to parse.
- Duplicate notifications on a worker restart: the row is stored before the alert now.
- `go.mod` `replace` directives are honoured — Kubernetes redirects more than a hundred of its own
  modules to `./staging`, and the requires alone reported versions nothing compiles.

## 1.1.0

First tagged release.

- **MCP server** at `POST /mcp`: twelve tools for agents, all read-only except
  `explain_vulnerability`. Stateless, behind the same API key as the REST API.
- **Telegram**: cycle alerts with Acknowledge and Resolve buttons, a weekly digest of outdated
  dependencies, and direct messages to system owners. The bot answers with the chat id of whoever
  writes to it, and ignores anyone who is not the configured destination.
- **Tunnels**: a registry with one file per provider, ngrok and Cloudflare quick tunnels.
  `PUBLIC_URL` beats both.
- **Passkey authentication** for the console.
- **Documentation site**: `docs/` renders as a static site, with navigation coming from the index
  table in `docs/README.md`.
