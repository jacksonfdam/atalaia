# Sources

Atalaia ships a catalog of the public vulnerability databases it knows about (`config/vulnerability-databases.json`, kept in step with [haxdoggy/vulnerability-databases](https://github.com/haxdoggy/vulnerability-databases)). The catalog is deliberately larger than the set Atalaia collects: a database you cannot collect is still worth seeing, along with the reason.

Each source with an adapter can be switched on or off at runtime, from the console's **Sources** page or through the API. The choice is stored in the database, so it survives a restart; sources you never touch keep following the default shipped in the registry.

```bash
curl -X PATCH -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"enabled":true}' http://localhost:3000/api/v1/feeds/ubuntu

curl -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/feeds/catalog
```

| Source | Default | Notes |
|--------|---------|-------|
| `nvd` | on | CVSS, CWE and CPE enrichment. |
| `cisa` | on | Known Exploited Vulnerabilities — the only source that marks active exploitation. |
| `mitre` | on | Authoritative CVE records, read from `cvelistV5`'s delta. Capped by `MITRE_MAX_RECORDS`. |
| `opencve` | on | Vendor/product correlation. |
| `ghsa` | on | GitHub advisories, package-level precision. Needs `GITHUB_TOKEN` for a usable rate limit. |
| `euvd` | on | ENISA's European database. |
| `snyk` | on | Scraped. |
| `vuldb` | on | RSS; rarely carries a CVSS score. |
| `redhat` | off | Vendor source, for Red Hat and CentOS based images. |
| `ubuntu` | off | Vendor source, for Debian and Ubuntu based images. |
| `zdi` | off | Often published before a patch exists. |
| `certeu` | off | Regional, largely redundant with NVD. |
| `certfr` | off | Regional, French. |
| `cvedetails` | off | Blocks scrapers with a 403. |

Most of these publish a catalogue, not a window: CISA serves the whole KEV list on every fetch, OpenCVE pages through its own, Snyk and GHSA return a listing. Only NVD and MITRE ask their source for what is recent. So the monitoring cycle applies one age cutoff to everything it collects — `VULN_MAX_AGE_DAYS`, seven days by default — and an advisory older than that is dropped before anything is alerted or stored. An advisory a source publishes with no date at all is dropped too, and logged with the source's name: the age of it cannot be established, and substituting today's date is exactly how a 2021 advisory reaches a chat marked as new.

A source that answers with zero items is reported as `EMPTY` rather than healthy, and the health report shows how many of the items actually carry a CVSS score — a feed can be alive and still be useless for triage.

A source that is missing its credentials or its URL is `NOT_CONFIGURED`, and the row says which setting is missing. It is a separate status because it is a separate problem: `EMPTY` means the source answered and had nothing, `NOT_CONFIGURED` means it was never called. Both count towards the degraded tally in the console — an enabled source collecting nothing is worth knowing about either way — but only one of them is the source's fault.
