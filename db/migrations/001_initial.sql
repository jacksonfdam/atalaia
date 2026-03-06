CREATE TABLE IF NOT EXISTS vulnerabilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cve_id TEXT UNIQUE NOT NULL,
    title TEXT,
    description TEXT,
    severity TEXT CHECK(severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),
    cvss_score REAL,
    exploited INTEGER DEFAULT 0,
    source TEXT NOT NULL,
    source_url TEXT,
    affected_technologies TEXT,       -- JSON array as text: '["nginx","react"]'
    status TEXT DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
    status_changed_by TEXT,           -- 'slack:U12345', 'api:scanner', 'api:manual'
    status_changed_at TEXT,
    client_explanation TEXT,          -- LLM-generated plain-English explanation
    first_seen_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT DEFAULT (datetime('now')),
    notified_at TEXT,
    resolved_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_vulns_cve ON vulnerabilities(cve_id);
CREATE INDEX idx_vulns_status ON vulnerabilities(status);
CREATE INDEX idx_vulns_severity ON vulnerabilities(severity);
CREATE INDEX idx_vulns_tech ON vulnerabilities(affected_technologies);
