# Correctness

## Why this page exists

Most of Atalaia's code was written by a language model under my direction. This page is about what that means for whether you can rely on it.

I am not going to argue that AI-authored code is fine in general. I am going to describe what stops a wrong answer from reaching you, tell you exactly where that protection runs out, and give you the commands to check both.

## The failure that matters

A dependency scanner has two failure modes and they are not equally bad.

A **false positive** costs an hour. Annoying, self-correcting, you notice it the moment you look.

A **false negative** is invisible. You do not find out that Atalaia missed a CVE until something else finds it, and in the meantime you have been running with the particular feeling of safety that made you stop checking by hand. A scanner that quietly misses things is worse than no scanner, because it replaces "I do not know what I am exposed to" with false confidence, and that is a downgrade.

Everything below is aimed at that, which is also why Atalaia is deliberately noisy at the edges. Where a match is ambiguous it flags rather than filters. You will see CVEs that do not actually reach you. That trade is on purpose, and the next section is the honest account of how coarse it currently is.

## Nothing that decides is generated

Severity, CVSS score and vector, exploited-in-the-wild status, source and advisory link are read from the feed and stored as they arrived. No model ranks, scores, filters or de-duplicates anything.

A model is asked for exactly three things, all of them prose, all of them after triage has already happened:

| Where | What it writes |
|---|---|
| `src/application/monitorVulns.js` | the plain-English explanation, when a CVE first arrives |
| `src/application/explainVulnerability.js` | the same explanation, on request, for CVEs collected before a model was configured |
| `src/application/acknowledgeVuln.js` | a mitigation suggestion, when somebody acknowledges |

That is the whole list, and it is one grep:

```bash
grep -rln "createLLMAdapter" src/
```

Four files come back — those three and the adapter itself. Nothing in `src/domain/`, nothing in the feed adapters, nothing in the correlation path, nothing in the notification routing.

Specifically, no model output is used for severity or CVSS, for exploited status, for whether a CVE matches your stack, for whether it reaches a given repository, for de-duplication across feeds — which is keyed on `cve_id`, not on meaning — or for who gets alerted. Turn the model off and Atalaia loses prose. The set of findings is unchanged, because nothing downstream of the explanation reads it.

### It comes from one definition, and it is no longer labelled

Which text lands in the summary slot — the model's paragraph, or the advisory's own words when no model is configured — is decided once, in `src/infrastructure/notifiers/shortVersion.js`. Every surface reads that one definition: Slack, Teams, Telegram, the alert email, and the weekly digest in both its email and console forms. `tests/unit/infrastructure/shortVersion.test.js` asserts the model's text is never silently capped and that no channel has reintroduced its own copy of the fallback.

Each channel used to have its own `clientExplanation || description`, under a heading that named neither, so a reader could not tell which one they had. That was found while writing this page, which is roughly the argument for writing one.

**The heading that named which is gone**, removed on request because it read as noise above every alert. `shortVersion` still returns `generated`, so the answer exists and any caller may render it — nothing does today. So: a reader looking at a summary cannot tell from the summary whether a model wrote it. What still holds is everything above — the text is prose, it decides nothing, and turning the model off changes no finding. The row itself is unambiguous either way: `client_explanation` is populated only by a model, and the advisory's own words live in `description`.

### Nothing a model says arrives with its throat-clearing

Asked for a paragraph, an assistant-tuned model tends to answer "Certainly! Here's an explanation for your non-technical audience:" and then the paragraph. Both prompts now forbid it, and because a prompt is a request rather than a guarantee, `src/infrastructure/llm/cleanAnswer.js` removes it from every answer before it is stored — wrapped around the provider, so a fifth call site added later cannot skip it.

It is deliberately narrow: an opener that introduces the answer, and nothing else. An explanation that merely begins with one of those words is left alone, and an answer that is *only* an introduction is left alone too, because blanking it would hide a model failing behind an empty explanation. `tests/unit/infrastructure/cleanAnswer.test.js` pins both halves.

## What is enforced

### Read-only, outward

Atalaia never opens a pull request, never edits a manifest, never gates a build, and never phones home.

That is asserted, not promised. `tests/unit/infrastructure/githubProvider.test.js` checks two things: the provider module contains no write call at all — no `axios.post/put/patch/delete`, no `method: 'POST'` — and every method that talks to GitHub goes through the single GET helper, so a new one cannot quietly route around it.

The same file asserts a subtler thing worth naming, because it is the shape of a false negative: a throttled read used to return an empty file list, which made a rate-limited scan look like a repository with no manifests. Zero dependencies, no error, sweep reported success. A refused read now throws.

If you find a code path that could write to one of your repositories, that is a security issue rather than a bug — [private reporting](https://github.com/jacksonfdam/atalaia/security/advisories), not an issue.

### Saying "unknown" instead of guessing

`src/application/versionComparison.js` answers one question — does the constraint in your manifest already allow the newest published release — and refuses to answer when it cannot. A digest pin, a commit SHA, a Maven or NuGet interval such as `[1.0,2.0)`: each returns `unknown` with the reason attached rather than a comfortable `current`.

The same disposition runs through the rest: a feed returning zero items is `EMPTY`, not healthy, and a repository nobody has scanned says so rather than reading as clean.

### One list, not two

A source that was monitored but invisible to the health check, or a parser registered in one place and not the other, is a gap that nobody notices until it matters. Feeds live in one registry (`src/infrastructure/feeds/feedRegistry.js`, 14 sources — 8 on by default, 6 off with the reason stated in the file), parsers in another (`src/infrastructure/parsers/parserRegistry.js`, 12 ecosystems), queues and MCP tools likewise. The monitoring cycle and the health endpoint read the same list.

## What is not verified

This is the part I would read first if I were you.

**Correlation is by name, not by version range.** This is the largest gap and it is structural, not a missing test. Atalaia decides that a CVE reaches a repository by matching the advisory's affected technologies against your dependency names and vendor/product pairs. It does not store advisory version ranges and does not evaluate them. A CVE affecting `lodash < 4.17.21` will be flagged for a repository on `lodash 4.17.21`. In the direction that matters this errs safe — it over-reports rather than under-reports — but "does this CVE reach *this version*" is a question Atalaia does not currently answer, and the README's promise should be read as "which of your repositories contains the affected package".

**The technology filter is a substring match.** `monitorVulns.js` builds a filter from your scanned dependency names and asks whether the advisory text contains any of them. Short or generic package names will match text that has nothing to do with them.

**Most parsers have no tests.** Twelve ecosystems, thirteen parser modules, and two of them are covered: `githubActionsParser` and `gradleCatalogParser`. There is no fixture project per ecosystem and no comparison against the package managers' own resolution. That comparison — `npm ls --json`, `go list -m all`, `pip freeze` — is the check I most want and do not yet have, because the package manager is the one oracle that will not agree with me out of politeness.

**`versionComparison.js` has no tests.** Semver prerelease ordering, RubyGems pessimistic constraints, PEP 440 compatible-release operators and GitHub Actions tag ranges all live in that file, all behave differently, and none of them behave the way you would guess. It is the most intricate deterministic code in the repository and it is unasserted.

**Feed adapters have no recorded fixtures.** When a source changes its schema, the parser will produce fewer items or none, and nothing fails. Feed health reports `EMPTY` rather than healthy, which is a real backstop, but it is a runtime signal and not a build one.

**There is no OSV integration.** OSV is deliberately not in the monitoring cycle — it is queried per package, which suits lockfile scanning rather than a stream of recent advisories, and the reason is recorded in `src/infrastructure/feeds/databaseCatalog.js`. If you want lockfile-against-OSV, run OSV-Scanner; it answers a different question and the two compose.

## Where the model was worst

Since I am asking you to weigh AI authorship, here is what it actually cost on this project.

The expensive failures were not wrong algorithms. They were **plausible shapes with the substance missing**, and they all read fine.

The clearest is correlation. `correlateVulnerability.js` is structured exactly like something that evaluates version ranges — it names ecosystems, it walks affected technologies, it has the right seams — and it compares names. Nothing about reading it suggests the version dimension is absent; you have to go looking for the field that would hold the range and notice it was never stored. The scaffolding of rigour, without the rigour. That is the failure mode to watch for, and it is exactly the one that produces a confident false negative.

The second was silent duplication. The fallback described above existed in five files, each subtly different in truncation and heading, each individually reasonable. No single edit was wrong. The drift was the bug.

The third was mechanical and cheap by comparison: during the Postgres migration, four separate places where a promise was used as a value — `filter()` with an async predicate keeps everything, because a promise is truthy. Fast to find once the shape was known, and they are in `CLAUDE.md` now precisely so the shape stays known.

I read every line, which raises the floor. It does not make me a compiler, and the three above got through it.

## Verify any of this yourself

None of it requires taking my word:

```bash
git clone https://github.com/jacksonfdam/atalaia.git
cd atalaia
pnpm install

# every place a model is called — four files, three of them prose
grep -rln "createLLMAdapter" src/

# every channel reads one labelling definition
grep -rln "shortVersion" src/

# the read-only surface, the labelling, and everything else asserted
pnpm test
```

`pnpm test` runs the unit suites offline. The integration suites need a Postgres and skip with a message when `TEST_DATABASE_URL` is unset, rather than passing quietly — see [running](running.md).

## If you find a miss

Open an issue with the CVE identifier, the ecosystem, the manifest entry and what you expected. A confirmed false negative gets a regression test before it gets a fix, and credit in the changelog unless you would rather not have it.

The gaps in *What is not verified* are known and do not need reporting. A miss that is not explained by one of them is the interesting kind, and I would like to see it.
