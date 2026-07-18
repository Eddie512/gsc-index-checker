-- Two small indexes for queries that were scanning whole partitions.
--
-- 1) The journeys default view (`WHERE property_id = ? AND page_count > 1
--    ORDER BY started_at DESC LIMIT ?` and its COUNT) read every session for
--    the property (~50k rows to return 50; COUNT read all of them). This
--    partial index holds only multi-page sessions in (property, started_at)
--    order, so the list walks newest-first and stops at LIMIT, and the COUNT
--    touches only qualifying rows.
--
-- 2) The scheduled picker's 2-hour error-streak query relied on a skip-scan of
--    idx_runs_property_type_started, which the planner only chooses when
--    ANALYZE stats exist — prod has none, so it scanned the whole index
--    (~16k rows every 7 minutes). (run_type, started_at) makes it a direct
--    range seek with no reliance on stats.
--
-- Apply to production:
--   wrangler d1 execute gsc-index-checker --remote \
--     --file=migrations/0004_sessions_and_runs_indexes.sql

CREATE INDEX IF NOT EXISTS idx_sessions_property_started_multi
  ON sessions(property_id, started_at)
  WHERE page_count > 1;

CREATE INDEX IF NOT EXISTS idx_runs_type_started
  ON check_runs(run_type, started_at);
