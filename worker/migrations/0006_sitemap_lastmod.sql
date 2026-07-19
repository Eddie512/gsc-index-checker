-- Track each URL's sitemap <lastmod> so Indexing API submissions are
-- change-aware.
--
-- The sync cron now stores the newest lastmod the sitemap has declared per
-- URL (monotonically advancing). getUrlsToSubmit uses it two ways:
--   * URL_UPDATED resubmissions require the page to have changed since the
--     last submission (lastmod or scraped content date advanced) — if Google
--     ignored a submission and nothing changed, we stop spending quota on it.
--   * lastmod newer than Google's last crawl now counts as a staleness
--     trigger, so pages that declare updates get submitted even if content
--     scraping never found a date for them.
--
-- Applied exactly once via `wrangler d1 migrations apply` (ALTER TABLE has no
-- IF NOT EXISTS, so this relies on the d1_migrations tracking table).

ALTER TABLE urls ADD COLUMN sitemap_lastmod TEXT;
