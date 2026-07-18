-- Per-day pageview rollup, so the hot analytics reads stop re-scanning raw
-- pageviews on every call.
--
-- pageview_daily holds (property × path × UTC day) session/view counts. The
-- :00/:30 cron upserts the last two days (pageviews are insert-only with
-- ts = now, so older days never change); cleanupOldAnalytics prunes it to the
-- same 30-day horizon as pageviews. getTopPages, getPathTraffic (/api/traffic),
-- and the urls traffic join now read this table — a few hundred rows per call
-- instead of ~70k raw pageviews.
--
-- Semantics note: whole-window session counts become the sum of per-day
-- distinct counts (a session spanning UTC midnight counts once per day it
-- touches), and windows are UTC calendar days instead of rolling hours.
--
-- The final INSERT backfills the current 30-day window from raw pageviews —
-- one full scan, after which the cron only ever touches two days at a time.
--
-- Apply to production:
--   wrangler d1 execute gsc-index-checker --remote \
--     --file=migrations/0005_pageview_daily_rollup.sql

CREATE TABLE IF NOT EXISTS pageview_daily (
  property_id TEXT NOT NULL,
  page_path   TEXT NOT NULL,
  day         TEXT NOT NULL,
  sessions    INTEGER NOT NULL DEFAULT 0,
  views       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, page_path, day)
);

CREATE INDEX IF NOT EXISTS idx_pageview_daily_property_day
  ON pageview_daily(property_id, day, page_path, sessions);

-- Widen the ts index into a covering one: the cron rebuild pins it via
-- INDEXED BY (the stat-less planner would otherwise answer the ts range with a
-- full scan of the property-first covering index). Its ts prefix still serves
-- the 30-day retention DELETE that idx_pageviews_ts existed for.
DROP INDEX IF EXISTS idx_pageviews_ts;
CREATE INDEX IF NOT EXISTS idx_pageviews_ts_path_session
  ON pageviews(ts, property_id, page_path, session_id);

INSERT INTO pageview_daily (property_id, page_path, day, sessions, views)
SELECT property_id, page_path, date(ts), COUNT(DISTINCT session_id), COUNT(*)
  FROM pageviews
 GROUP BY property_id, page_path, date(ts)
ON CONFLICT(property_id, page_path, day)
DO UPDATE SET sessions = excluded.sessions, views = excluded.views;
