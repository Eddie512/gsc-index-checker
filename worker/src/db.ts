/**
 * D1 database queries for the GSC index checker.
 * All URL/run queries are scoped by property_id.
 */

import type { InspectionResult } from './gsc-api';

// ---------------------------------------------------------------------------
// Property types & queries
// ---------------------------------------------------------------------------

export interface Property {
  id: string;
  name: string;
  site_url: string;
  domain: string;
  sitemap_url: string | null;
}

/** Get all properties. */
export async function getProperties(db: D1Database): Promise<Property[]> {
  const result = await db
    .prepare('SELECT * FROM properties ORDER BY name ASC')
    .all<Property>();
  return result.results;
}

/** Get a single property by ID. */
export async function getProperty(
  db: D1Database,
  id: string
): Promise<Property | null> {
  return db.prepare('SELECT * FROM properties WHERE id = ?').bind(id).first<Property>();
}

/** Create a new property. */
export async function createProperty(
  db: D1Database,
  property: { id: string; name: string; site_url: string; domain: string; sitemap_url: string | null }
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO properties (id, name, site_url, domain, sitemap_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(property.id, property.name, property.site_url, property.domain, property.sitemap_url, now)
    .run();
}

/** Update an existing property. */
export async function updateProperty(
  db: D1Database,
  id: string,
  fields: { name: string; site_url: string; domain: string; sitemap_url: string | null }
): Promise<void> {
  await db
    .prepare(
      `UPDATE properties SET name = ?, site_url = ?, domain = ?, sitemap_url = ? WHERE id = ?`
    )
    .bind(fields.name, fields.site_url, fields.domain, fields.sitemap_url, id)
    .run();
}

/** Delete a property and all its associated data. */
export async function deleteProperty(
  db: D1Database,
  id: string
): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM urls WHERE property_id = ?').bind(id),
    db.prepare('DELETE FROM check_runs WHERE property_id = ?').bind(id),
    db.prepare('DELETE FROM sessions WHERE property_id = ?').bind(id),
    db.prepare('DELETE FROM pageviews WHERE property_id = ?').bind(id),
    db.prepare('DELETE FROM http_events WHERE property_id = ?').bind(id),
    db.prepare('DELETE FROM deleted_urls WHERE property_id = ?').bind(id),
    db.prepare('DELETE FROM properties WHERE id = ?').bind(id),
  ]);
}

// ---------------------------------------------------------------------------
// URL operations (all scoped by property_id)
// ---------------------------------------------------------------------------

/** Batch-insert URLs for a property (more efficient for large sitemap syncs). */
export async function upsertUrls(
  db: D1Database,
  propertyId: string,
  urls: string[]
): Promise<void> {
  const now = new Date().toISOString();
  const batchSize = 50;

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const statements = batch.map((url) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO urls (url, property_id, first_seen_at, created_at) VALUES (?, ?, ?, ?)`
        )
        .bind(url, propertyId, now, now)
    );
    await db.batch(statements);
  }
}

export interface ReconcileResult {
  markedForDeletion: number;
  deleted: number;
  restored: number;
}

/**
 * Reconcile DB URLs against the current sitemap for a property.
 *
 * - Indexed URLs no longer in the sitemap → set removed_from_sitemap_at
 * - Non-indexed URLs no longer in the sitemap → DELETE immediately
 * - Previously marked-removed URLs that are no longer indexed → DELETE (Google already knows)
 * - URLs that reappeared in the sitemap → clear removed_from_sitemap_at
 */
export async function reconcileUrls(
  db: D1Database,
  propertyId: string,
  sitemapUrls: string[]
): Promise<ReconcileResult> {
  const sitemapSet = new Set(sitemapUrls);

  // Fetch all DB URLs for this property
  const dbRows = await db
    .prepare(
      `SELECT url, index_status, removed_from_sitemap_at FROM urls WHERE property_id = ?`
    )
    .bind(propertyId)
    .all<{ url: string; index_status: string | null; removed_from_sitemap_at: string | null }>();

  const now = new Date().toISOString();
  const toMarkRemoved: string[] = [];
  const toDelete: string[] = [];
  const toRestore: string[] = [];

  for (const row of dbRows.results) {
    const inSitemap = sitemapSet.has(row.url);

    if (!inSitemap && !row.removed_from_sitemap_at) {
      // URL dropped from sitemap
      if (row.index_status === 'PASS') {
        toMarkRemoved.push(row.url);
      } else {
        toDelete.push(row.url);
      }
    } else if (!inSitemap && row.removed_from_sitemap_at && row.index_status !== 'PASS') {
      // Was marked for URL_DELETED but Google already de-indexed it — no submission needed
      toDelete.push(row.url);
    } else if (inSitemap && row.removed_from_sitemap_at) {
      // URL came back into sitemap
      toRestore.push(row.url);
    }
  }

  const batchSize = 50;

  // Mark indexed URLs as removed
  for (let i = 0; i < toMarkRemoved.length; i += batchSize) {
    const batch = toMarkRemoved.slice(i, i + batchSize);
    const stmts = batch.map((url) =>
      db.prepare('UPDATE urls SET removed_from_sitemap_at = ? WHERE url = ? AND property_id = ?')
        .bind(now, url, propertyId)
    );
    await db.batch(stmts);
  }

  // Archive and delete non-indexed URLs
  for (let i = 0; i < toDelete.length; i += batchSize) {
    const batch = toDelete.slice(i, i + batchSize);
    const archiveStmts = batch.map((url) =>
      db.prepare(
        `INSERT INTO deleted_urls (url, property_id, index_status, removed_from_sitemap_at, reason)
         SELECT url, property_id, index_status, removed_from_sitemap_at, 'reconcile'
         FROM urls WHERE url = ? AND property_id = ?`
      ).bind(url, propertyId)
    );
    await db.batch(archiveStmts);
    const deleteStmts = batch.map((url) =>
      db.prepare('DELETE FROM urls WHERE url = ? AND property_id = ?')
        .bind(url, propertyId)
    );
    await db.batch(deleteStmts);
  }

  // Restore URLs that reappeared
  for (let i = 0; i < toRestore.length; i += batchSize) {
    const batch = toRestore.slice(i, i + batchSize);
    const stmts = batch.map((url) =>
      db.prepare('UPDATE urls SET removed_from_sitemap_at = NULL WHERE url = ? AND property_id = ?')
        .bind(url, propertyId)
    );
    await db.batch(stmts);
  }

  return {
    markedForDeletion: toMarkRemoved.length,
    deleted: toDelete.length,
    restored: toRestore.length,
  };
}

/** Update a URL with inspection results.
 *  When a URL becomes indexed (PASS), reset the submission counter
 *  so it can be resubmitted if it later falls out of the index. */
export async function updateInspection(
  db: D1Database,
  url: string,
  result: InspectionResult
): Promise<void> {
  const now = new Date().toISOString();
  const isIndexed = result.indexStatus === 'PASS';
  await db
    .prepare(
      `UPDATE urls SET
        last_crawl_time  = ?,
        index_status     = ?,
        coverage_state   = ?,
        crawl_status     = ?,
        page_fetch_state = ?,
        robots_status    = ?,
        referring_urls   = ?,
        last_checked_at  = ?,
        indexing_submit_count = CASE WHEN ? THEN 0 ELSE indexing_submit_count END,
        indexing_submitted_at = CASE WHEN ? THEN NULL ELSE indexing_submitted_at END
      WHERE url = ?`
    )
    .bind(
      result.lastCrawlTime,
      result.indexStatus,
      result.coverageState,
      result.crawlStatus,
      result.pageFetchState,
      result.robotsStatus,
      result.referringUrls ? JSON.stringify(result.referringUrls) : null,
      now,
      isIndexed ? 1 : 0,
      isIndexed ? 1 : 0,
      url
    )
    .run();
}

/** Update label for a single URL (scoped by property_id). */
export async function updateLabel(
  db: D1Database,
  url: string,
  propertyId: string,
  label: string | null
): Promise<void> {
  await db
    .prepare('UPDATE urls SET label = ? WHERE url = ? AND property_id = ?')
    .bind(label, url, propertyId)
    .run();
}

/** Bulk-update label for multiple URLs matching a filter. */
export async function bulkUpdateLabel(
  db: D1Database,
  propertyId: string,
  label: string | null,
  options: { q?: string; status?: string; labelFilter?: string }
): Promise<number> {
  const conditions: string[] = ['property_id = ?'];
  const params: (string | null)[] = [label, propertyId];

  if (options.q) {
    conditions.push('url LIKE ?');
    params.push(`%${options.q}%`);
  }
  if (options.status === 'unchecked') {
    conditions.push('last_checked_at IS NULL');
  } else if (options.status) {
    conditions.push('index_status = ?');
    params.push(options.status);
  }
  if (options.labelFilter === '__unlabeled__') {
    conditions.push('label IS NULL');
  } else if (options.labelFilter) {
    conditions.push('label = ?');
    params.push(options.labelFilter);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const result = await db
    .prepare(`UPDATE urls SET label = ? ${where}`)
    .bind(...params)
    .run();

  return result.meta?.changes || 0;
}

/** Get all distinct labels for a property. */
export async function getDistinctLabels(
  db: D1Database,
  propertyId: string
): Promise<string[]> {
  const result = await db
    .prepare(
      'SELECT DISTINCT label FROM urls WHERE property_id = ? AND label IS NOT NULL ORDER BY label ASC'
    )
    .bind(propertyId)
    .all<{ label: string }>();
  return result.results.map((r) => r.label);
}

/** Get URLs that need checking, ordered by priority (scoped by property). */
export async function getUrlsToCheck(
  db: D1Database,
  propertyId: string,
  limit: number
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT url FROM urls
       WHERE property_id = ?
       ORDER BY
         CASE WHEN last_checked_at IS NULL THEN 0 ELSE 1 END,
         last_checked_at ASC
       LIMIT ?`
    )
    .bind(propertyId, limit)
    .all<{ url: string }>();

  return result.results.map((r) => r.url);
}

/**
 * Get URLs whose content_updated_at needs refreshing.
 * Prioritizes: never-checked, then oldest-checked.
 * Only returns URLs that haven't been scraped in the last 24 hours.
 */
export async function getUrlsForContentScrape(
  db: D1Database,
  propertyId: string,
  limit: number
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT url FROM urls
       WHERE property_id = ?
         AND (content_scraped_at IS NULL
              OR content_scraped_at < datetime('now', '-1 day'))
       ORDER BY
         CASE WHEN content_scraped_at IS NULL THEN 0 ELSE 1 END,
         content_scraped_at ASC
       LIMIT ?`
    )
    .bind(propertyId, limit)
    .all<{ url: string }>();
  return result.results.map((r) => r.url);
}

/** Mark URLs as scraped (regardless of whether a date was found). */
export async function markUrlsScraped(
  db: D1Database,
  urls: string[]
): Promise<void> {
  const now = new Date().toISOString();
  const batchSize = 50;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const statements = batch.map((url) =>
      db.prepare('UPDATE urls SET content_scraped_at = ? WHERE url = ?').bind(now, url)
    );
    await db.batch(statements);
  }
}

/** Record an inspection run for history tracking. */
export async function recordRun(
  db: D1Database,
  propertyId: string,
  startedAt: string,
  finishedAt: string,
  checked: number,
  indexed: number,
  notIndexed: number,
  errors: number,
  details?: Record<string, string | number> | null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO check_runs
       (property_id, run_type, started_at, finished_at, urls_checked, urls_indexed, urls_not_indexed, urls_error, details)
       VALUES (?, 'inspect', ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(propertyId, startedAt, finishedAt, checked, indexed, notIndexed, errors, details ? JSON.stringify(details) : null)
    .run();
}

/** Record a generic activity run (sync, scrape, etc.). */
export async function recordActivity(
  db: D1Database,
  propertyId: string,
  runType: RunType,
  startedAt: string,
  finishedAt: string,
  details: Record<string, number | string>
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO check_runs
       (property_id, run_type, started_at, finished_at, urls_checked, urls_indexed, urls_not_indexed, urls_error, details)
       VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?)`
    )
    .bind(propertyId, runType, startedAt, finishedAt, JSON.stringify(details))
    .run();
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

export interface DashboardStats {
  total: number;
  indexed: number;
  notIndexed: number;
  unchecked: number;
  checked: number;
}

export async function getStats(
  db: D1Database,
  propertyId: string
): Promise<DashboardStats> {
  const [total, indexed, notIndexed, unchecked] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS c FROM urls WHERE property_id = ?').bind(propertyId).first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) AS c FROM urls WHERE property_id = ? AND index_status = 'PASS'").bind(propertyId).first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) AS c FROM urls WHERE property_id = ? AND index_status IS NOT NULL AND index_status != 'PASS'").bind(propertyId).first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) AS c FROM urls WHERE property_id = ? AND last_checked_at IS NULL').bind(propertyId).first<{ c: number }>(),
  ]);

  const t = total?.c || 0;
  const u = unchecked?.c || 0;

  return {
    total: t,
    indexed: indexed?.c || 0,
    notIndexed: notIndexed?.c || 0,
    unchecked: u,
    checked: t - u,
  };
}

/** Get stats scoped to a filter (label, search, status). */
export async function getFilteredStats(
  db: D1Database,
  propertyId: string,
  options: { q?: string; status?: string; labelFilter?: string }
): Promise<DashboardStats> {
  const conditions: string[] = ['property_id = ?'];
  const params: string[] = [propertyId];

  if (options.q) {
    conditions.push('url LIKE ?');
    params.push(`%${options.q}%`);
  }
  if (options.status === 'unchecked') {
    conditions.push('last_checked_at IS NULL');
  } else if (options.status === 'notindexed') {
    conditions.push("index_status IS NOT NULL AND index_status != 'PASS'");
  } else if (options.status) {
    conditions.push('index_status = ?');
    params.push(options.status);
  }
  if (options.labelFilter === '__unlabeled__') {
    conditions.push('label IS NULL');
  } else if (options.labelFilter) {
    conditions.push('label = ?');
    params.push(options.labelFilter);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [total, indexed, notIndexed, unchecked] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS c FROM urls ${where}`).bind(...params).first<{ c: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM urls ${where} AND index_status = 'PASS'`).bind(...params).first<{ c: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM urls ${where} AND index_status IS NOT NULL AND index_status != 'PASS'`).bind(...params).first<{ c: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM urls ${where} AND last_checked_at IS NULL`).bind(...params).first<{ c: number }>(),
  ]);

  const t = total?.c || 0;
  const u = unchecked?.c || 0;

  return {
    total: t,
    indexed: indexed?.c || 0,
    notIndexed: notIndexed?.c || 0,
    unchecked: u,
    checked: t - u,
  };
}

// ---------------------------------------------------------------------------
// URL rows & pagination
// ---------------------------------------------------------------------------

export interface UrlRow {
  url: string;
  index_status: string | null;
  coverage_state: string | null;
  last_crawl_time: string | null;
  last_checked_at: string | null;
  first_seen_at: string | null;
  label: string | null;
  content_updated_at: string | null;
  indexing_submitted_at: string | null;
  removed_from_sitemap_at: string | null;
  traffic: number;
}

export type RunType = 'inspect' | 'sync' | 'scrape';

export interface RunRow {
  id: number;
  run_type: RunType;
  started_at: string | null;
  finished_at: string | null;
  urls_checked: number;
  urls_indexed: number;
  urls_not_indexed: number;
  urls_error: number;
  details: string | null;
}

/** Get paginated URL rows with optional filters. */
export async function getUrls(
  db: D1Database,
  propertyId: string,
  options: {
    q?: string;
    status?: string;
    labelFilter?: string;
    sort?: string;
    dir?: string;
    page?: number;
    perPage?: number;
  }
): Promise<{ urls: UrlRow[]; total: number }> {
  const {
    q,
    status,
    labelFilter,
    sort = 'last_checked_at',
    dir = 'desc',
    page = 1,
    perPage = 100,
  } = options;

  const allowedSorts = [
    'url', 'index_status', 'last_crawl_time',
    'last_checked_at', 'first_seen_at', 'coverage_state', 'label',
    'content_updated_at', 'indexing_submitted_at', 'traffic',
  ];
  const safeSort = allowedSorts.includes(sort) ? sort : 'last_checked_at';
  const safeDir = dir === 'asc' ? 'ASC' : 'DESC';

  const conditions: string[] = ['property_id = ?'];
  const params: (string | number)[] = [propertyId];

  if (q) {
    conditions.push('url LIKE ?');
    params.push(`%${q}%`);
  }

  if (status === 'unchecked') {
    conditions.push('last_checked_at IS NULL');
  } else if (status === 'notindexed') {
    conditions.push("index_status IS NOT NULL AND index_status != 'PASS'");
  } else if (status) {
    conditions.push('index_status = ?');
    params.push(status);
  }

  if (labelFilter === '__unlabeled__') {
    conditions.push('label IS NULL');
  } else if (labelFilter) {
    conditions.push('label = ?');
    params.push(labelFilter);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countResult = await db
    .prepare(`SELECT COUNT(*) AS c FROM urls ${where}`)
    .bind(...params)
    .first<{ c: number }>();
  const total = countResult?.c || 0;

  // Get the domain for this property to strip from URLs when matching paths
  const propRow = await db
    .prepare('SELECT domain FROM properties WHERE id = ?')
    .bind(propertyId)
    .first<{ domain: string }>();
  const domain = propRow?.domain || '';

  const offset = (page - 1) * perPage;
  // Always push NULLs to the bottom regardless of sort direction
  const nullLast = safeSort === 'traffic' ? '' : `CASE WHEN u.${safeSort} IS NULL THEN 1 ELSE 0 END,`;

  const rows = await db
    .prepare(
      `SELECT u.url, u.index_status, u.coverage_state, u.last_crawl_time, u.last_checked_at, u.first_seen_at, u.label, u.content_updated_at, u.indexing_submitted_at, u.removed_from_sitemap_at,
              COALESCE(pv.cnt, 0) AS traffic
       FROM urls u
       LEFT JOIN (
         SELECT page_path, COUNT(*) AS cnt
         FROM pageviews
         WHERE property_id = ? AND ts >= datetime('now', '-30 days')
         GROUP BY page_path
       ) pv ON pv.page_path = REPLACE(u.url, 'https://${domain}', '')
       ${where.replace(/property_id/g, 'u.property_id')}
       ORDER BY ${nullLast} ${safeSort === 'traffic' ? 'traffic' : `u.${safeSort}`} ${safeDir}
       LIMIT ? OFFSET ?`
    )
    .bind(propertyId, ...params, perPage, offset)
    .all<UrlRow>();

  return { urls: rows.results, total };
}

/** Get check runs for a property. */
export async function getRuns(
  db: D1Database,
  propertyId: string
): Promise<RunRow[]> {
  const result = await db
    .prepare('SELECT * FROM check_runs WHERE property_id = ? ORDER BY id DESC LIMIT 100')
    .bind(propertyId)
    .all<RunRow>();
  return result.results;
}

/** Batch-update content_updated_at from a URL → date map. */
export async function syncContentUpdatedDates(
  db: D1Database,
  dateMap: Map<string, string>
): Promise<number> {
  let updated = 0;
  const entries = Array.from(dateMap.entries());
  const batchSize = 50;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const statements = batch.map(([url, date]) =>
      db
        .prepare('UPDATE urls SET content_updated_at = ? WHERE url = ?')
        .bind(date, url)
    );
    await db.batch(statements);
    updated += batch.length;
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Indexing API tracking
// ---------------------------------------------------------------------------

/** Count how many indexing submissions have been made today (UTC) — global across all properties. */
export async function getIndexingSubmittedToday(
  db: D1Database
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const result = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM urls
       WHERE indexing_submitted_at >= ? AND indexing_submitted_at < ?`
    )
    .bind(`${today}T00:00:00Z`, `${today}T23:59:59Z`)
    .first<{ c: number }>();
  return result?.c || 0;
}

export interface UrlSubmission {
  url: string;
  type: 'URL_UPDATED' | 'URL_DELETED';
}

/** Maximum number of times a URL can be submitted before giving up. */
const MAX_SUBMIT_COUNT = 3;

/**
 *  Get URLs to submit to the Indexing API, ordered by priority:
 *  1. URLs removed from sitemap that were indexed → URL_DELETED
 *  2. URLs unknown to Google (coverage_state contains 'unknown') → URL_UPDATED
 *  3. Stale pages (content updated after last crawl) → URL_UPDATED
 *
 * Scoped by property. Uses exponential backoff: cooldown = 7 × 2^(count-1) days.
 * Stops resubmitting after MAX_SUBMIT_COUNT attempts.
 */
export async function getUrlsToSubmit(
  db: D1Database,
  propertyId: string,
  limit: number
): Promise<UrlSubmission[]> {
  // Exponential backoff filter:
  // - Skip URLs that have been submitted MAX_SUBMIT_COUNT or more times
  // - Cooldown = 7 * 2^(submit_count - 1) days, e.g. 7d → 14d → 28d
  const backoffFilter = `
    AND indexing_submit_count < ${MAX_SUBMIT_COUNT}
    AND (
      indexing_submitted_at IS NULL
      OR julianday('now') - julianday(indexing_submitted_at)
         >= 7.0 * (1 << MAX(indexing_submit_count - 1, 0))
    )`;

  // Priority 1: URLs removed from sitemap (indexed) → URL_DELETED
  const removed = await db
    .prepare(
      `SELECT url FROM urls
       WHERE property_id = ?
       AND removed_from_sitemap_at IS NOT NULL
       ${backoffFilter}
       ORDER BY removed_from_sitemap_at ASC
       LIMIT ?`
    )
    .bind(propertyId, limit)
    .all<{ url: string }>();

  const deletions: UrlSubmission[] = removed.results.map((r) => ({
    url: r.url,
    type: 'URL_DELETED' as const,
  }));

  const remaining = limit - deletions.length;
  if (remaining <= 0) return deletions;

  // Priority 2 & 3: Updated URLs → URL_UPDATED
  const updated = await db
    .prepare(
      `SELECT url FROM urls
       WHERE property_id = ?
       AND removed_from_sitemap_at IS NULL
       AND (
         -- Priority 2: Unknown to Google
         (coverage_state LIKE '%unknown%')
         OR
         -- Priority 3: Stale pages — only if already inspected
         -- and Google has an established crawl date
         (content_updated_at IS NOT NULL
          AND last_checked_at IS NOT NULL AND last_crawl_time IS NOT NULL
          AND content_updated_at > last_crawl_time)
       )
       ${backoffFilter}
       ORDER BY
         CASE WHEN coverage_state LIKE '%unknown%' THEN 0 ELSE 1 END,
         content_updated_at DESC
       LIMIT ?`
    )
    .bind(propertyId, remaining)
    .all<{ url: string }>();

  const updates: UrlSubmission[] = updated.results.map((r) => ({
    url: r.url,
    type: 'URL_UPDATED' as const,
  }));

  return [...deletions, ...updates];
}

/** Record that a URL was submitted to the Indexing API (increments submit count). */
export async function recordIndexingSubmission(
  db: D1Database,
  url: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      'UPDATE urls SET indexing_submitted_at = ?, indexing_submit_count = indexing_submit_count + 1 WHERE url = ?'
    )
    .bind(now, url)
    .run();
}

/** Delete a URL that was successfully submitted as URL_DELETED.
 *  Archives it to deleted_urls first for audit trail. */
export async function deleteRemovedUrl(
  db: D1Database,
  url: string,
  propertyId: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO deleted_urls (url, property_id, index_status, removed_from_sitemap_at, reason)
       SELECT url, property_id, index_status, removed_from_sitemap_at, 'deindexed'
       FROM urls WHERE url = ? AND property_id = ?`
    )
    .bind(url, propertyId)
    .run();
  await db
    .prepare('DELETE FROM urls WHERE url = ? AND property_id = ?')
    .bind(url, propertyId)
    .run();
}

/** Get URLs recently submitted to the Indexing API, with their current index status. */
export async function getRecentlySubmitted(
  db: D1Database,
  propertyId: string,
  limit: number = 100
): Promise<UrlRow[]> {
  const result = await db
    .prepare(
      `SELECT url, index_status, coverage_state, last_crawl_time, last_checked_at, first_seen_at, label, content_updated_at, indexing_submitted_at, removed_from_sitemap_at
       FROM urls
       WHERE property_id = ? AND indexing_submitted_at IS NOT NULL
       ORDER BY indexing_submitted_at DESC
       LIMIT ?`
    )
    .bind(propertyId, limit)
    .all<UrlRow>();
  return result.results;
}

// ---------------------------------------------------------------------------
// Analytics — session & pageview tracking
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  visitor_id: string | null;
  property_id: string;
  landing_page: string;
  referrer: string | null;
  country: string | null;
  city: string | null;
  device: string | null;
  screen_w: number | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  ref_domain: string | null;
  browser: string | null;
  exit_page: string | null;
  is_returning: number;
  max_scroll: number | null;
  language: string | null;
  page_count: number;
  duration_s: number;
  started_at: string;
  updated_at: string;
}

export interface Pageview {
  id: number;
  session_id: string;
  property_id: string;
  page_path: string;
  max_scroll: number | null;
  ts: string;
}

/** Record a pageview — creates or updates the session, inserts the pageview. */
export async function recordPageview(
  db: D1Database,
  propertyId: string,
  sessionId: string,
  visitorId: string | null,
  pagePath: string,
  referrer: string | null,
  isNewSession: boolean,
  country: string | null = null,
  city: string | null = null,
  device: string | null = null,
  screenW: number | null = null,
  utmSource: string | null = null,
  utmMedium: string | null = null,
  utmCampaign: string | null = null,
  refDomain: string | null = null,
  browser: string | null = null,
  language: string | null = null,
  isReturning: boolean = false
): Promise<void> {
  const now = new Date().toISOString();

  if (isNewSession) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO sessions (id, visitor_id, property_id, landing_page, referrer, country, city, device, screen_w, utm_source, utm_medium, utm_campaign, ref_domain, browser, language, is_returning, page_count, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .bind(sessionId, visitorId, propertyId, pagePath, referrer, country, city, device, screenW, utmSource, utmMedium, utmCampaign, refDomain, browser, language, isReturning ? 1 : 0, now, now)
      .run();
  } else {
    // Update page count and exit page
    await db
      .prepare(
        `UPDATE sessions SET page_count = page_count + 1, exit_page = ?, updated_at = ? WHERE id = ?`
      )
      .bind(pagePath, now, sessionId)
      .run();
  }

  await db
    .prepare(
      `INSERT INTO pageviews (session_id, property_id, page_path, ts) VALUES (?, ?, ?, ?)`
    )
    .bind(sessionId, propertyId, pagePath, now)
    .run();
}

/** Update session duration and page-level scroll (called on page unload via sendBeacon). */
export async function updateSessionDuration(
  db: D1Database,
  sessionId: string,
  durationS: number,
  maxScroll: number | null = null,
  pagePath: string | null = null
): Promise<void> {
  // Always update session duration
  await db
    .prepare('UPDATE sessions SET duration_s = MAX(duration_s, ?) WHERE id = ?')
    .bind(durationS, sessionId)
    .run();

  // Update scroll on the specific pageview
  if (maxScroll !== null && pagePath) {
    await db
      .prepare(
        `UPDATE pageviews SET max_scroll = MAX(COALESCE(max_scroll, 0), ?)
         WHERE session_id = ? AND page_path = ?
         AND id = (SELECT id FROM pageviews WHERE session_id = ? AND page_path = ? ORDER BY ts DESC LIMIT 1)`
      )
      .bind(maxScroll, sessionId, pagePath, sessionId, pagePath)
      .run();
  }
}

export interface JourneySession extends Session {
  pages: Pageview[];
}

/** Get multi-page sessions for a property, with their pageviews. */
export interface JourneyFilters {
  pathFilter?: string;
  pathMode?: 'includes' | 'started';
  country?: string;
  device?: string;
}

export async function getJourneys(
  db: D1Database,
  propertyId: string,
  page: number = 1,
  perPage: number = 50,
  filters: JourneyFilters = {}
): Promise<{ sessions: JourneySession[]; total: number }> {
  const { pathFilter, pathMode = 'includes', country, device } = filters;
  const needsPageviewJoin = pathFilter && pathMode === 'includes';

  const baseFrom = needsPageviewJoin
    ? 'sessions s JOIN pageviews pv ON pv.session_id = s.id'
    : 'sessions s';
  const prefix = needsPageviewJoin ? 's.' : 's.';

  const wheres: string[] = [`${prefix}property_id = ?`];
  const params: (string | number)[] = [propertyId];

  if (pathFilter && pathMode === 'started') {
    wheres.push(`${prefix}landing_page = ?`);
    params.push(pathFilter);
  } else if (pathFilter) {
    wheres.push('pv.page_path = ?');
    params.push(pathFilter);
  } else {
    wheres.push(`${prefix}page_count > 1`);
  }

  if (country) {
    wheres.push(`${prefix}country = ?`);
    params.push(country);
  }
  if (device) {
    wheres.push(`${prefix}device = ?`);
    params.push(device);
  }

  const whereClause = wheres.join(' AND ');
  const distinct = needsPageviewJoin ? 'DISTINCT ' : '';

  const countSql = `SELECT COUNT(${distinct}${prefix}id) AS c FROM ${baseFrom} WHERE ${whereClause}`;
  const listSql = `SELECT ${distinct}${prefix}* FROM ${baseFrom} WHERE ${whereClause} ORDER BY ${prefix}started_at DESC LIMIT ? OFFSET ?`;

  const countResult = await db.prepare(countSql).bind(...params).first<{ c: number }>();
  const total = countResult?.c ?? 0;

  const offset = (page - 1) * perPage;
  const sessionRows = await db
    .prepare(listSql)
    .bind(...params, perPage, offset)
    .all<Session>();

  if (sessionRows.results.length === 0) {
    return { sessions: [], total };
  }

  // Fetch all pageviews for these sessions in batched queries
  // to stay under D1's SQL variable limit (~100)
  const sessionIds = sessionRows.results.map((s) => s.id);
  const CHUNK_SIZE = 30;
  const pvMap = new Map<string, Pageview[]>();

  for (let i = 0; i < sessionIds.length; i += CHUNK_SIZE) {
    const chunk = sessionIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const pvRows = await db
      .prepare(
        `SELECT * FROM pageviews
         WHERE session_id IN (${placeholders})
         ORDER BY ts ASC`
      )
      .bind(...chunk)
      .all<Pageview>();

    for (const pv of pvRows.results) {
      const list = pvMap.get(pv.session_id) || [];
      list.push(pv);
      pvMap.set(pv.session_id, list);
    }
  }

  const sessions: JourneySession[] = sessionRows.results.map((s) => ({
    ...s,
    pages: pvMap.get(s.id) || [],
  }));

  return { sessions, total };
}

/** Get past sessions (with pageviews) for a set of visitor_ids, excluding specific session IDs. */
export async function getPastSessionsByVisitors(
  db: D1Database,
  propertyId: string,
  visitorIds: string[],
  excludeSessionIds: string[],
  limitPerVisitor: number = 5
): Promise<Map<string, JourneySession[]>> {
  if (visitorIds.length === 0) return new Map();

  const CHUNK_SIZE = 30;
  const excludeSet = new Set(excludeSessionIds);

  // Fetch sessions in batched queries to stay under D1's SQL variable limit
  const allSessionRows: Session[] = [];
  for (let i = 0; i < visitorIds.length; i += CHUNK_SIZE) {
    const chunk = visitorIds.slice(i, i + CHUNK_SIZE);
    const vPlaceholders = chunk.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `SELECT * FROM sessions
         WHERE property_id = ? AND visitor_id IN (${vPlaceholders})
         ORDER BY started_at DESC
         LIMIT ?`
      )
      .bind(propertyId, ...chunk, chunk.length * limitPerVisitor)
      .all<Session>();
    allSessionRows.push(...rows.results);
  }

  // Filter out excluded session IDs in JS
  const filteredSessions = allSessionRows.filter((s) => !excludeSet.has(s.id));

  if (filteredSessions.length === 0) return new Map();

  // Fetch pageviews in batches
  const sIds = filteredSessions.map((s) => s.id);
  const pvMap = new Map<string, Pageview[]>();
  for (let i = 0; i < sIds.length; i += CHUNK_SIZE) {
    const chunk = sIds.slice(i, i + CHUNK_SIZE);
    const sPh = chunk.map(() => '?').join(',');
    const pvRows = await db
      .prepare(
        `SELECT * FROM pageviews WHERE session_id IN (${sPh}) ORDER BY ts ASC`
      )
      .bind(...chunk)
      .all<Pageview>();

    for (const pv of pvRows.results) {
      const list = pvMap.get(pv.session_id) || [];
      list.push(pv);
      pvMap.set(pv.session_id, list);
    }
  }

  // Group by visitor_id, limit per visitor
  const result = new Map<string, JourneySession[]>();
  for (const s of filteredSessions) {
    if (!s.visitor_id) continue;
    const list = result.get(s.visitor_id) || [];
    if (list.length < limitPerVisitor) {
      list.push({ ...s, pages: pvMap.get(s.id) || [] });
      result.set(s.visitor_id, list);
    }
  }

  return result;
}


/** Get top pages by visit count for a property (last 30 days). */
export async function getTopPages(
  db: D1Database,
  propertyId: string,
  limit: number = 30
): Promise<{ page_path: string; views: number }[]> {
  const result = await db
    .prepare(
      `SELECT page_path, COUNT(*) AS views
       FROM pageviews
       WHERE property_id = ? AND ts >= datetime('now', '-30 days')
       GROUP BY page_path
       ORDER BY views DESC
       LIMIT ?`
    )
    .bind(propertyId, limit)
    .all<{ page_path: string; views: number }>();

  return result.results;
}

/** Delete analytics data older than 30 days. */
export async function cleanupOldAnalytics(db: D1Database): Promise<{ sessions: number; pageviews: number; events: number }> {
  const [s, p, e] = await Promise.all([
    db.prepare("DELETE FROM sessions WHERE started_at < datetime('now', '-30 days')").run(),
    db.prepare("DELETE FROM pageviews WHERE ts < datetime('now', '-30 days')").run(),
    db.prepare("DELETE FROM http_events WHERE ts < datetime('now', '-30 days')").run(),
  ]);
  return {
    sessions: s.meta?.changes ?? 0,
    pageviews: p.meta?.changes ?? 0,
    events: e.meta?.changes ?? 0,
  };
}

// ─── HTTP Events (404s, Redirects) ─────────────────────────────────────

export interface HttpEvent {
  id: number;
  property_id: string;
  url: string;
  status_code: number;
  redirect_to: string | null;
  referrer: string | null;
  country: string | null;
  city: string | null;
  device: string | null;
  ts: string;
}

/** Record an HTTP event (404, 301, etc). */
export async function recordHttpEvent(
  db: D1Database,
  propertyId: string,
  url: string,
  statusCode: number,
  redirectTo: string | null = null,
  referrer: string | null = null,
  country: string | null = null,
  city: string | null = null,
  device: string | null = null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO http_events (property_id, url, status_code, redirect_to, referrer, country, city, device, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(propertyId, url, statusCode, redirectTo, referrer, country, city, device)
    .run();
}

/** Get recent HTTP events for a property, optionally filtered by status. */
export async function getHttpEvents(
  db: D1Database,
  propertyId: string,
  statusFilter: number | null = null,
  limit: number = 100
): Promise<{ events: HttpEvent[]; counts: { status_code: number; count: number }[] }> {
  // Get counts by status code
  const countsResult = await db
    .prepare(
      `SELECT status_code, COUNT(*) AS count FROM http_events WHERE property_id = ? GROUP BY status_code ORDER BY count DESC`
    )
    .bind(propertyId)
    .all<{ status_code: number; count: number }>();

  // Get events
  let query = `SELECT * FROM http_events WHERE property_id = ?`;
  const params: (string | number)[] = [propertyId];
  if (statusFilter !== null) {
    query += ` AND status_code = ?`;
    params.push(statusFilter);
  }
  query += ` ORDER BY ts DESC LIMIT ?`;
  params.push(limit);

  const eventsResult = await db
    .prepare(query)
    .bind(...params)
    .all<HttpEvent>();

  return { events: eventsResult.results, counts: countsResult.results };
}

/** Get top 404 URLs aggregated by count. */
export async function getTop404s(
  db: D1Database,
  propertyId: string,
  limit: number = 15
): Promise<{ url: string; count: number }[]> {
  const result = await db
    .prepare(
      `SELECT url, COUNT(*) AS count FROM http_events
       WHERE property_id = ? AND status_code = 404
       GROUP BY url ORDER BY count DESC LIMIT ?`
    )
    .bind(propertyId, limit)
    .all<{ url: string; count: number }>();
  return result.results;
}
