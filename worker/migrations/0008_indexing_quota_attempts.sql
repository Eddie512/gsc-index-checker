-- Attempt-based Indexing API quota accounting.
--
-- The daily budget was previously derived from successful submissions
-- (urls.indexing_submitted_at, UTC day) — but Google's 200/day quota counts
-- every publish attempt, including failures, and resets at midnight Pacific,
-- not UTC. The mismatch showed up in production: 144 recorded successes plus
-- 56 unrecorded failed attempts hit Google's 200, after which every cron run
-- burned its batch on 429s for ten hours while our counter thought 56
-- remained.
--
-- One row per Google quota day (YYYY-MM-DD in America/Los_Angeles).
-- runIndexingSubmissions increments per attempt and clamps the day to the
-- full quota on a 429; rows are pruned with the other 30-day retention.
--
-- Applied exactly once via `wrangler d1 migrations apply`.

CREATE TABLE IF NOT EXISTS indexing_quota (
  day      TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0
);
