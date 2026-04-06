CREATE TABLE IF NOT EXISTS properties (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  site_url      TEXT NOT NULL,
  domain        TEXT NOT NULL,
  sitemap_url   TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS urls (
  url              TEXT,
  property_id      TEXT,
  last_crawl_time  TEXT,
  index_status     TEXT,
  coverage_state   TEXT,
  crawl_status     TEXT,
  page_fetch_state TEXT,
  robots_status    TEXT,
  referring_urls   TEXT,
  label            TEXT,
  content_updated_at TEXT,
  content_scraped_at TEXT,
  indexing_submitted_at TEXT,
  indexing_submit_count INTEGER DEFAULT 0,
  removed_from_sitemap_at TEXT,
  last_checked_at  TEXT,
  first_seen_at    TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (url, property_id)
);

CREATE TABLE IF NOT EXISTS check_runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id      TEXT,
  run_type         TEXT DEFAULT 'inspect',
  started_at       TEXT,
  finished_at      TEXT,
  urls_checked     INTEGER DEFAULT 0,
  urls_indexed     INTEGER DEFAULT 0,
  urls_not_indexed INTEGER DEFAULT 0,
  urls_error       INTEGER DEFAULT 0,
  details          TEXT
);

CREATE INDEX IF NOT EXISTS idx_urls_last_checked ON urls(last_checked_at);
CREATE INDEX IF NOT EXISTS idx_urls_index_status ON urls(index_status);
CREATE INDEX IF NOT EXISTS idx_urls_label ON urls(label);
CREATE INDEX IF NOT EXISTS idx_urls_property ON urls(property_id);
CREATE INDEX IF NOT EXISTS idx_runs_property ON check_runs(property_id);

-- Analytics: user journey tracking
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  visitor_id    TEXT,
  property_id   TEXT NOT NULL,
  landing_page  TEXT NOT NULL,
  referrer      TEXT,
  country       TEXT,
  city          TEXT,
  device        TEXT,
  screen_w      INTEGER,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  ref_domain    TEXT,
  browser       TEXT,
  language      TEXT,
  exit_page     TEXT,
  is_returning  INTEGER DEFAULT 0,
  max_scroll    INTEGER,
  page_count    INTEGER DEFAULT 1,
  duration_s    INTEGER DEFAULT 0,
  started_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pageviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  property_id TEXT NOT NULL,
  page_path   TEXT NOT NULL,
  max_scroll  INTEGER,
  ts          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS http_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id TEXT NOT NULL,
  url         TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  redirect_to TEXT,
  referrer    TEXT,
  country     TEXT,
  city        TEXT,
  device      TEXT,
  ts          TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_property ON sessions(property_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_pageviews_session ON pageviews(session_id);
CREATE INDEX IF NOT EXISTS idx_pageviews_property ON pageviews(property_id);
CREATE INDEX IF NOT EXISTS idx_events_property ON http_events(property_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON http_events(status_code);
CREATE INDEX IF NOT EXISTS idx_events_ts ON http_events(ts);

-- Audit trail: permanently keep records of deleted URLs
CREATE TABLE IF NOT EXISTS deleted_urls (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  url                   TEXT NOT NULL,
  property_id           TEXT NOT NULL,
  index_status          TEXT,
  removed_from_sitemap_at TEXT,
  reason                TEXT NOT NULL DEFAULT 'unknown',
  deleted_at            TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deleted_urls_property ON deleted_urls(property_id);
CREATE INDEX IF NOT EXISTS idx_deleted_urls_deleted_at ON deleted_urls(deleted_at);
