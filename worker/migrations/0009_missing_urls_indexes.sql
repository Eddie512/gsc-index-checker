-- Close index drift between schema.sql and the production urls table.
--
-- Prod predates multi-property support and never got idx_urls_property or
-- idx_urls_label (fresh installs from schema.sql have both). The visible cost:
-- getUrlsToSubmit runs ~1,274×/day and each run full-scanned all ~1,400 urls
-- rows (queryEfficiency 0 in D1 insights — ~1.8M rows/day). With the property
-- index the stat-less planner switches to a per-property seek (verified with
-- EXPLAIN on a stats-free database).

CREATE INDEX IF NOT EXISTS idx_urls_property ON urls(property_id);
CREATE INDEX IF NOT EXISTS idx_urls_label ON urls(label);
