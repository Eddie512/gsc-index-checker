-- Re-index check_runs for the candidate-property picker.
--
-- The picker (scheduled handler) now runs two small queries instead of one
-- full-history scan:
--   A) SELECT property_id, MAX(started_at) ... WHERE run_type='inspect' GROUP BY property_id
--   B) SELECT property_id, COUNT(*)        ... WHERE run_type='inspect' AND ... AND started_at > ?
--
-- Putting run_type between property_id and started_at lets A do a per-property
-- seek to the latest inspect run and B prune to the last 2 hours — instead of
-- scanning every row. Verified with EXPLAIN QUERY PLAN: A plans as a COVERING
-- per-group seek, B as a pruned skip-scan. (property_id, started_at) was only
-- ever used by this picker, so replacing it is safe.
--
-- Pair this with the 30-day check_runs retention added to cleanupOldAnalytics,
-- which stops the table from growing without bound.
--
-- Apply to production:
--   wrangler d1 execute gsc-index-checker --remote \
--     --file=migrations/0003_check_runs_picker_index.sql

DROP INDEX IF EXISTS idx_runs_property_started;

CREATE INDEX IF NOT EXISTS idx_runs_property_type_started
  ON check_runs(property_id, run_type, started_at);
