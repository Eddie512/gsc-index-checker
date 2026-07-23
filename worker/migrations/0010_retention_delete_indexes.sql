-- Indexes for the two retention DELETEs that were scanning their tables.
--
-- cleanupOldAnalytics runs hourly; its check_runs delete filters on
-- started_at (no existing index leads with it → ~16k-row scan per run,
-- ~350k rows/day) and its pageview_daily delete filters on day (not a
-- prefix of the (property_id, page_path, day) primary key → ~42k-row scan,
-- ~900k rows/day). Verified stat-free that both plans flip from SCAN to a
-- range seek with these.

CREATE INDEX IF NOT EXISTS idx_runs_started ON check_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_pageview_daily_day ON pageview_daily(day);
