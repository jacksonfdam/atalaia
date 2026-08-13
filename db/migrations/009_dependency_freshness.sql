-- Latest published version of each dependency, cached per row.
--
-- Kept next to the dependency rather than fetched on render: a repository has
-- hundreds of dependencies, each lookup is a request to somebody else's
-- registry, and the answer changes on the order of days. Each row is written
-- the moment its own lookup returns, so a check that dies halfway still leaves
-- everything it already resolved.
ALTER TABLE repository_dependencies ADD COLUMN latest_version TEXT;
ALTER TABLE repository_dependencies ADD COLUMN latest_checked_at TEXT;
ALTER TABLE repository_dependencies ADD COLUMN latest_error TEXT;
