-- Which versions of a package an advisory says are affected.
--
-- Until now a vulnerability knew only the *names* it touches
-- (vulnerabilities.affected_technologies), so a repository that depended on the
-- package stayed exposed whatever version it ran: fixing the dependency could
-- never clear the finding. The ranges live in their own table, one row per
-- (vulnerability, source, ecosystem, package, range), for two reasons:
--
--   * a CVE is stored once, by whichever feed delivered it first, and a later
--     feed is never allowed to rewrite it. A table keyed by source can be filled
--     in afterwards, by an enrichment job, without touching the CVE row;
--   * affected_technologies stays what it is — a coarse, indexed prefilter —
--     and the range check is a second step on the few rows that survive it.
--
-- vulnerable_range is kept as the source wrote it (GitHub: ">= 1.0, < 1.2.3");
-- turning it into something comparable is the evaluator's job, per ecosystem.

CREATE TABLE IF NOT EXISTS advisory_packages (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vulnerability_id  bigint NOT NULL REFERENCES vulnerabilities (id) ON DELETE CASCADE,
    source            text NOT NULL,
    ecosystem         text NOT NULL,
    package_name      text NOT NULL,
    vulnerable_range  text NOT NULL,
    first_patched     text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (vulnerability_id, source, ecosystem, package_name, vulnerable_range)
);

CREATE INDEX IF NOT EXISTS idx_advisory_packages_name ON advisory_packages (package_name);
CREATE INDEX IF NOT EXISTS idx_advisory_packages_vuln ON advisory_packages (vulnerability_id);

-- When the enrichment job last asked for this CVE's ranges, whether or not it
-- found any. Without it a CVE no source knows would be asked about every run.
ALTER TABLE vulnerabilities ADD COLUMN IF NOT EXISTS ranges_checked_at timestamptz;

-- Every distinct version of a package that one manifest holds. A lockfile can
-- carry the same package twice (4.17.21 and 5.0.0); `version` keeps the lower
-- one, which is right for "how far behind" and wrong for "is any copy
-- vulnerable". NULL when the file has only one.
ALTER TABLE repository_dependencies ADD COLUMN IF NOT EXISTS versions jsonb;
