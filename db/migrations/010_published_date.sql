-- When the advisory was published, as opposed to when we first saw it.
--
-- The entity has carried publishedDate since the beginning and nothing ever
-- stored it, so the cycle had no way to tell a CVE disclosed this morning from
-- one CISA added to the KEV catalogue in 2021 — and the catalogue is served
-- whole, every fetch. Every one of those arrived as "new" the first time the
-- database was empty, and every one was alerted.
--
-- Nullable on purpose: a feed that publishes no date must say so rather than be
-- stamped with now(), which is exactly how stale advisories read as fresh.
ALTER TABLE vulnerabilities ADD COLUMN IF NOT EXISTS published_date timestamptz;

CREATE INDEX IF NOT EXISTS idx_vulns_published ON vulnerabilities (published_date DESC NULLS LAST);
