-- The findings themselves.
--
-- Identity is cve_id: the same CVE arrives from several feeds and is merged on
-- that key rather than stored per source.
--
-- affected_technologies is jsonb, not a JSON string. The tech filter and the
-- relevance counters both ask "does this array contain that name", which is an
-- equality test over the elements rather than a substring hunt through text.
CREATE TABLE IF NOT EXISTS vulnerabilities (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cve_id                 text UNIQUE NOT NULL,
    title                  text,
    description            text,
    severity               text CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),
    cvss_score             real,
    exploited              boolean NOT NULL DEFAULT false,
    source                 text NOT NULL,
    source_url             text,
    affected_technologies  jsonb NOT NULL DEFAULT '[]'::jsonb,
    status                 text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    status_changed_by      text,           -- 'slack:U12345', 'api:scanner', 'api:manual'
    status_changed_at      timestamptz,
    client_explanation     text,           -- LLM-generated plain-English explanation
    first_seen_at          timestamptz NOT NULL DEFAULT now(),
    last_seen_at           timestamptz NOT NULL DEFAULT now(),
    notified_at            timestamptz,
    resolved_at            timestamptz,
    created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vulns_status ON vulnerabilities (status);
CREATE INDEX IF NOT EXISTS idx_vulns_severity ON vulnerabilities (severity);
CREATE INDEX IF NOT EXISTS idx_vulns_first_seen ON vulnerabilities (first_seen_at DESC);

-- GIN over the array: the relevance query asks whether any of a repository's
-- dependencies is named in here, once per candidate row.
CREATE INDEX IF NOT EXISTS idx_vulns_tech ON vulnerabilities USING gin (affected_technologies);
