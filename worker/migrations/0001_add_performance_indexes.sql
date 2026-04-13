-- Performance indexes added to cut D1 row reads.
--
-- Context: gsc-index-checker was reading ~28M rows/day from D1 because all the
-- analytics queries on `pageviews` (30-day traffic joins, top-page, session-by-path,
-- and the DELETE-old-pageviews retention job) could only narrow by property_id and
-- then had to scan every row in that partition to filter by `ts`. Similarly the
-- candidate-property picker scanned every `check_runs` row per property.
--
-- Apply to production:
--   wrangler d1 execute gsc-index-checker --remote \
--     --file=migrations/0001_add_performance_indexes.sql

-- ─── pageviews ─────────────────────────────────────────────────────────
-- Supports the retention DELETE (`WHERE ts < datetime('now','-30 days')`).
CREATE INDEX IF NOT EXISTS idx_pageviews_ts
  ON pageviews(ts);

-- Supports analytics that filter by property + time range
-- (top pages, traffic-per-url, etc.).
CREATE INDEX IF NOT EXISTS idx_pageviews_property_ts
  ON pageviews(property_id, ts);

-- Supports sessions-by-page lookups that join pageviews by page_path for a property.
CREATE INDEX IF NOT EXISTS idx_pageviews_property_path
  ON pageviews(property_id, page_path);

-- ─── check_runs ────────────────────────────────────────────────────────
-- Composite index for candidate-property picker: per-property MAX(started_at)
-- and recent-error-streak window filter.
CREATE INDEX IF NOT EXISTS idx_runs_property_started
  ON check_runs(property_id, started_at);
