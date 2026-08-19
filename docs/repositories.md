# Organizations and repositories

Atalaia correlates CVEs against the code you actually ship, which means knowing your repositories. Register a GitHub organization (or user) with a read-only token under **Settings → Organizations** and import them; several organizations with different tokens is the normal case, and each token is stored encrypted and never returned by the API.

```bash
curl -X POST -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"login":"my-company","token":"ghp_…"}' \
  http://localhost:3000/api/v1/organizations

curl -X POST -H "X-API-Key: $API_KEY" \
  http://localhost:3000/api/v1/organizations/my-company/import
```

**Everything Atalaia does against GitHub is read-only.** It lists repositories, reads their language breakdown and reads manifest files. Every request in the provider goes through one GET helper; nothing is ever written back — no issues, no commits, no status checks.

**One repository at a time.** Clicking a repository's name opens its own page — exposure, dependencies and technologies as tabs, each panel loading independently so nothing blocks the rest. The ↗ next to the name leaves for GitHub. Table headers sort: click one to sort by it, click it again to flip the direction.

**Are we behind?** The Dependencies tab shows the declared version next to the **latest published one**, asked of each ecosystem's own registry — npm, PyPI, crates.io, RubyGems, Packagist, NuGet, the Go module proxy, Maven Central, pub.dev, and GitHub releases for actions. The lookups run detached, a few at a time, and each row is written the moment its own answer arrives, so the table fills in while you watch and an interrupted check keeps everything it already resolved. Answers are cached for a day; **Re-check all** ignores the cache. Docker, Terraform and Helm are listed as not checkable — their versions depend on which registry the artifact came from. Swift is not checkable for the same reason — a package resolves from whatever git repository it was pinned to, and there is no central index. CocoaPods has one, trunk, but it is not wired up yet, and the row says so rather than reading as current.

**Lockfiles read.** npm (`package-lock.json`, `npm-shrinkwrap.json`), pnpm (`pnpm-lock.yaml`), Yarn (`yarn.lock`, both the classic format and Berry's), Bun (`bun.lock`), Python (`poetry.lock`, `uv.lock`, `pdm.lock`, `Pipfile.lock`), Composer (`composer.lock`), RubyGems (`Gemfile.lock`), Cargo (`Cargo.lock`), Go (`go.sum`), Swift (`Package.resolved`), CocoaPods (`Podfile.lock`), Dart (`pubspec.lock`) and Helm (`Chart.lock`). Transitive entries count: most of an npm tree arrives transitively and a CVE does not care how a package got into the build.

**`bun.lockb` cannot be read.** It is a custom binary format, not text, and there is nothing to parse line by line. A Bun repository has to commit `bun.lock` — the text format, and the default since Bun 1.2 — to be scanned. Stated rather than worked around, because a repository with only `bun.lockb` reads as having no dependencies and that is worth knowing.

**One package, two versions, one row.** A lockfile routinely holds the same package more than once — `rust-lang/cargo`'s own lockfile has 23 crates at two or three versions each, and an npm tree carries duplicates under nested `node_modules` paths. A dependency is unique on repository, ecosystem, name and manifest file, so one file stores one row per package and **the lower version is the one kept**: if 1.3.2 is vulnerable and 2.13.0 is patched, keeping the newer one turns a real exposure into a row that reads as clean. The reverse error — reporting something as behind when a patched copy sits alongside it — is one you can see and answer.

**A lockfile beats the manifest beside it.** A manifest declares a constraint, a lockfile states what is in the build, and only the second one answers whether you are exposed: `^4.17.0` cannot say whether the installed copy is 4.17.11, which is vulnerable, or 4.17.21, which is not. So when both files name the same package, the lockfile's row is the one stored and the manifest's is dropped — otherwise the same package appears twice, once *behind* and once *current*, and every count doubles. The rule is scoped by directory: a lockfile speaks for its own directory and everything under it, which is what lets a workspace's root lockfile answer for `packages/*/package.json` while a monorepo's `apps/a` and `apps/b` keep their own rows. A package the lockfile does not list keeps its manifest row — an out-of-date lockfile must not make a dependency vanish.

Manifests do not declare versions, they declare *constraints* — `^4.17.0`, `~> 6.1`, `==2.28.0`, `v3`, a commit SHA — so each one is translated into a semver range and asked whether it already allows the newest release. `^5.0.0` against 5.2.1 is **current**; `^4.17.1` against it is **behind** by a major. Anything untranslatable — a digest pin, a Maven interval — answers *unknown* with the reason rather than guessing, because a false "up to date" is worse than an admitted gap. Each row shows how far behind it is: major, minor or patch.

Dependencies are **grouped by ecosystem**, since one repository routinely carries several: an Android project shows Gradle, GitHub Actions, its Fastlane gems and npm as separate tables, each with its own counts.

**Finding one among many.** `GET /api/v1/repositories` takes `search`, `org`, `language`, `enabled`, `archived` and `exposure` (`affected` / `exploited` / `clean`), sorts by `name`, `exposure`, `last_scanned_at`, `primary_language`, `org_key` or `updated_at` in either direction, and pages with `limit` (25 by default, 200 at most) and `offset`. The response carries the totals behind the page and the values the console needs for its filter menus. The console exposes all of it in the toolbar above the table.

**Personal accounts.** A token only ever exposes the private repositories of *its own* account, so registering someone else's login lists their public repositories and nothing more. The picker says so when that happens instead of quietly showing a short list.

**Importing a subset.** "Choose repos" lists everything the token can see — with a filter, and each row marked *new*, *tracked* or *removed here* — and imports only what is ticked. Whole-organization import stays one click away. From the terminal that is `atalaia org repos <key>` to list and `atalaia org import <key> --only org/a,org/b` to pick.

What the importer does:

- Lists every repository the token can see, including archived ones, which are imported **switched off** rather than skipped.
- Records the primary language, the language breakdown, topics and description.
- Leaves repositories you removed removed — a re-import does not resurrect them.
- Leaves your enable/disable choice alone — a re-import does not flip it back.

Per repository you get two independent views of its technologies: **languages and topics** as reported by GitHub, and **ecosystems** derived from the manifests found by a dependency scan. A repository can report "TypeScript" and still carry its risk inside a Dockerfile, so the two are shown separately.

Removing an organization also removes the repositories imported under it — they would otherwise be left with no credential that reaches them.

Tokens need read access only: `public_repo` (or `repo` for private ones) on a classic token, or *Contents: read-only* and *Metadata: read-only* on a fine-grained one.

## Only what touches you

The feeds carry everything published anywhere. On a real fleet the numbers look like this:

```
2025 collected · 27 name something we use · 21 of those are a container image or a CI action
```

So the console leads with the ones that land: **Vulnerabilities** defaults to *Affects our code* — the CVE names a dependency of an enabled, tracked repository. The other two positions are *Containers & CI only*, narrowed to Docker images, GitHub Actions, Terraform and Helm, and *Everything collected*, which is the raw feed. The same filter is on the API as `?relevance=affecting|infrastructure`, and every response carries the three counts so a header can say "27 of 2025" without a second request.

One definition backs both the filter and the counters, so the number in the header can never disagree with the rows beneath it. It depends on scans: a repository nobody scanned has no dependencies, and a CVE cannot be matched to it.

## When a vulnerability reaches a repository

A CVE only matters here if it lands in something you ship, so Atalaia answers that in both directions:

- **The alert says so.** The Slack message lists the affected repositories and the owners responsible, alongside the CVE itself.
- **The repository says so.** Repositories carry an **Exposure** column — worst severity, how many open CVEs, and a 🚨 when one of them is known-exploited. Expanding a row lists each CVE with the dependency and the manifest file it arrives through, which is the file you actually have to open.
- **The overview says so.** `EXPOSED_REPOS.LST` ranks the repositories carrying the most open CVEs.
- **The CVE says so.** A vulnerability's detail page lists the repositories it touches.

The link is computed, never stored: dependencies change with every scan and a CVE's technology list can be enriched after the fact, so a stored join would go quietly stale.

Coverage depends on a scan having run — `Scan all`, or the nightly schedule (`repositories.autoScan`). A fleet scan walks repositories **ten at a time** by default (`SCAN_CONCURRENCY`, or `concurrency` in the request body for one run) — at roughly ten seconds each, a fleet of four hundred is over an hour when done one by one. It is a queued job run by the worker: `POST` answers `202` with a job id, a second trigger gets `409`, and `GET /api/v1/repositories/scan-all` reports how many are done, which one is being scanned right now, and what failed. The console polls it and shows the same line. Because the state lives in the database rather than in the API process, restarting the API no longer loses the sweep or the progress describing it. Passing `{"skipVendorLookup": true}` drops the per-dependency OpenCVE lookup, which is most of the time.

Manifests parsed include npm, Python — `requirements.txt`, `Pipfile`, every lockfile below, and `pyproject.toml` **read for every tool that declares dependencies in it: PEP 621 `[project]`, extras, PEP 735 `[dependency-groups]` as `uv` writes them, and the Poetry, PDM and Hatch tables** — Go, Cargo, Maven, Gradle — build files **and `gradle/libs.versions.toml` version catalogs, where a modern Android or Kotlin Multiplatform project actually declares everything** — RubyGems (`Gemfile`, `fastlane/Pluginfile` and a gem's own `*.gemspec`, which is what a library repository has where an application has a Gemfile), NuGet, Composer, Terraform, Swift (`Package.resolved`), CocoaPods (`Podfile.lock`), Dart and Flutter (`pubspec.yaml` and `pubspec.lock`), Helm charts (`Chart.yaml` and `Chart.lock`), Dockerfiles and **GitHub Actions workflows** — CI pulls third-party actions and container images by tag, and a tag nobody upgrades on purpose is exactly where an old vulnerable dependency hides.

## What Atalaia does not do

Atalaia reports. Every team keeps ownership of its own upgrades, and of whether an upgrade is compatible with the rest of what it ships.

- **It never writes to GitHub.** No pull requests, no branches, no commits, no issues, no status checks. Every request in the provider goes through one GET helper, and a test fails the build if a write call appears in that file.
- **It never changes a manifest.** Nothing bumps a version, edits a lockfile or opens an upgrade.
- **It does not judge compatibility.** "Behind by a major" means the registry has a newer release than the manifest allows — not that upgrading is safe, wanted, or anyone's priority. Whether that major breaks you is a question about your code, and your code is where it gets answered.
- **It does not gate anything.** There is no build to fail and no threshold to enforce.

What it does instead: watch the public sources, work out which of your repositories a finding actually reaches, and tell the right people through Slack, email or the console.
