-- Compatibility unique index for the legacy urls table shape.
--
-- The production urls table predates multi-property support: it was created
-- with PRIMARY KEY (url) and property_id was added later via ALTER TABLE, so
-- it has no unique constraint on (url, property_id). upsertUrls' sitemap
-- upsert targets ON CONFLICT(url, property_id), which SQLite rejects without
-- a matching constraint — every sitemap sync failed with
-- "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"
-- (which also blocked new-URL inserts entirely).
--
-- A unique index satisfies the conflict target. Verified zero duplicate
-- (url, property_id) pairs in prod before adding (trivially true anyway,
-- since url alone is the primary key there). Fresh installs from schema.sql
-- don't need this — their composite PRIMARY KEY (url, property_id) already
-- serves the conflict target — but the index is harmless if present.

CREATE UNIQUE INDEX IF NOT EXISTS idx_urls_url_property
  ON urls(url, property_id);
