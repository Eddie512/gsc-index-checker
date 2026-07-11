-- One covering index for the pageviews analytics queries, so the hot
-- aggregations run as index-only scans with no per-row table lookup.
--
-- Replaces the two narrower indexes below; both are left-prefixes of the new
-- one, so nothing that used them regresses:
--   idx_pageviews_property_ts   (property_id, ts)
--   idx_pageviews_property_path (property_id, page_path)
--     → idx_pageviews_property_path_ts_session
--       (property_id, page_path, ts, session_id)
--
-- Column order (property_id, page_path, ts, session_id) is deliberate:
--   * property_id + page_path equality → journeys sessions-by-path and the
--     daily-breakdown IN-list seek straight to a path's rows;
--   * ts → time filter/CASE evaluated in-index, and a range bound once
--     page_path is pinned (daily breakdown);
--   * session_id → COUNT(DISTINCT session_id) answered from the index.
-- Verified with EXPLAIN QUERY PLAN: /api/traffic (top + daily), getTopPages,
-- the urls traffic join, and journeys count/list all plan as COVERING scans.
-- (getJourneys must also constrain pv.property_id — see that query.)
--
-- Apply to production:
--   wrangler d1 execute gsc-index-checker --remote \
--     --file=migrations/0002_covering_indexes.sql

DROP INDEX IF EXISTS idx_pageviews_property_ts;
DROP INDEX IF EXISTS idx_pageviews_property_path;

CREATE INDEX IF NOT EXISTS idx_pageviews_property_path_ts_session
  ON pageviews(property_id, page_path, ts, session_id);
