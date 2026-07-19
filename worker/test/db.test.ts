/**
 * Tests for db.ts — D1 database queries.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  upsertUrls,
  reconcileUrls,
  updateInspection,
  updateLabel,
  bulkUpdateLabel,
  getDistinctLabels,
  getUrlsToCheck,
  recordRun,
  getStats,
  getUrls,
  getRuns,
  getUrlsToSubmit,
  recordIndexingSubmission,
  deleteRemovedUrl,
  getPathTraffic,
  rebuildPageviewRollup,
  syncContentUpdatedDates,
} from '../src/db';
import { initDb, cleanDb, TEST_PROPERTY_ID } from './helpers';

const P = TEST_PROPERTY_ID;

describe('db — upsert', () => {
  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
  });

  it('batch-inserts multiple URLs', async () => {
    const urls = Array.from({ length: 120 }, (_, i) => `https://example.com/p${i}`);
    await upsertUrls(env.DB, P, urls);
    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM urls').first<{ c: number }>();
    expect(count!.c).toBe(120);
  });

  it('does not overwrite existing URLs', async () => {
    await upsertUrls(env.DB, P, ['https://example.com/page1']);
    const first = await env.DB
      .prepare('SELECT first_seen_at FROM urls WHERE url = ?')
      .bind('https://example.com/page1')
      .first<{ first_seen_at: string }>();

    await upsertUrls(env.DB, P, ['https://example.com/page1']);
    const second = await env.DB
      .prepare('SELECT first_seen_at FROM urls WHERE url = ?')
      .bind('https://example.com/page1')
      .first<{ first_seen_at: string }>();

    expect(first!.first_seen_at).toBe(second!.first_seen_at);
  });

  it('scopes URLs by property_id', async () => {
    await upsertUrls(env.DB, P, ['https://example.com/a']);
    await upsertUrls(env.DB, 'other-prop', ['https://example.com/a']);
    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM urls').first<{ c: number }>();
    expect(count!.c).toBe(2);
  });
});

describe('db — reconcileUrls', () => {
  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
    await upsertUrls(env.DB, P, [
      'https://example.com/indexed-page',
      'https://example.com/not-indexed-page',
      'https://example.com/unchecked-page',
      'https://example.com/still-in-sitemap',
    ]);
    // Mark one as indexed
    await updateInspection(env.DB, 'https://example.com/indexed-page', {
      indexStatus: 'PASS',
      coverageState: 'Submitted and indexed',
      lastCrawlTime: '2026-02-26T10:00:00Z',
      crawlStatus: 'DESKTOP',
      pageFetchState: 'SUCCESSFUL',
      robotsStatus: 'ALLOWED',
    });
    // Mark one as not indexed
    await updateInspection(env.DB, 'https://example.com/not-indexed-page', {
      indexStatus: 'NEUTRAL',
      coverageState: 'Discovered - currently not indexed',
      lastCrawlTime: null,
      crawlStatus: '',
      pageFetchState: '',
      robotsStatus: '',
    });
  });

  it('marks indexed URLs removed from sitemap for deletion', async () => {
    // Sitemap no longer contains indexed-page
    const result = await reconcileUrls(env.DB, P, [
      'https://example.com/not-indexed-page',
      'https://example.com/unchecked-page',
      'https://example.com/still-in-sitemap',
    ]);
    expect(result.markedForDeletion).toBe(1);
    const row = await env.DB
      .prepare('SELECT removed_from_sitemap_at FROM urls WHERE url = ?')
      .bind('https://example.com/indexed-page')
      .first<{ removed_from_sitemap_at: string | null }>();
    expect(row!.removed_from_sitemap_at).toBeTruthy();
  });

  it('deletes non-indexed URLs removed from sitemap immediately', async () => {
    // Sitemap no longer contains not-indexed-page or unchecked-page
    const result = await reconcileUrls(env.DB, P, [
      'https://example.com/indexed-page',
      'https://example.com/still-in-sitemap',
    ]);
    expect(result.deleted).toBe(2);
    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM urls WHERE property_id = ?')
      .bind(P).first<{ c: number }>();
    expect(count!.c).toBe(2);
  });

  it('restores URLs that reappear in sitemap', async () => {
    // First, mark indexed-page as removed
    await reconcileUrls(env.DB, P, [
      'https://example.com/not-indexed-page',
      'https://example.com/unchecked-page',
      'https://example.com/still-in-sitemap',
    ]);
    // Now it reappears in the sitemap
    const result = await reconcileUrls(env.DB, P, [
      'https://example.com/indexed-page',
      'https://example.com/not-indexed-page',
      'https://example.com/unchecked-page',
      'https://example.com/still-in-sitemap',
    ]);
    expect(result.restored).toBe(1);
    const row = await env.DB
      .prepare('SELECT removed_from_sitemap_at FROM urls WHERE url = ?')
      .bind('https://example.com/indexed-page')
      .first<{ removed_from_sitemap_at: string | null }>();
    expect(row!.removed_from_sitemap_at).toBeNull();
  });

  it('does not affect URLs still in the sitemap', async () => {
    const result = await reconcileUrls(env.DB, P, [
      'https://example.com/indexed-page',
      'https://example.com/not-indexed-page',
      'https://example.com/unchecked-page',
      'https://example.com/still-in-sitemap',
    ]);
    expect(result.markedForDeletion).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.restored).toBe(0);
  });

  it('does not affect other properties', async () => {
    await upsertUrls(env.DB, 'other-prop', ['https://example.com/other']);
    await reconcileUrls(env.DB, P, ['https://example.com/still-in-sitemap']);
    const otherCount = await env.DB
      .prepare("SELECT COUNT(*) AS c FROM urls WHERE property_id = 'other-prop'")
      .first<{ c: number }>();
    expect(otherCount!.c).toBe(1);
  });
});

describe('db — updateInspection', () => {
  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
    await upsertUrls(env.DB, P, ['https://example.com/test']);
  });

  it('updates inspection fields', async () => {
    await updateInspection(env.DB, 'https://example.com/test', {
      indexStatus: 'PASS',
      coverageState: 'Submitted and indexed',
      lastCrawlTime: '2026-02-26T10:00:00Z',
      crawlStatus: 'DESKTOP',
      pageFetchState: 'SUCCESSFUL',
      robotsStatus: 'ALLOWED',
    });

    const row = await env.DB
      .prepare('SELECT * FROM urls WHERE url = ?')
      .bind('https://example.com/test')
      .first();
    expect(row!.index_status).toBe('PASS');
    expect(row!.coverage_state).toBe('Submitted and indexed');
    expect(row!.last_crawl_time).toBe('2026-02-26T10:00:00Z');
    expect(row!.last_checked_at).toBeTruthy();
  });
});

describe('db — labels', () => {
  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
    await upsertUrls(env.DB, P, [
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);
  });

  it('sets a label on a single URL', async () => {
    await updateLabel(env.DB, 'https://example.com/a', P, 'holiday');
    const row = await env.DB
      .prepare('SELECT label FROM urls WHERE url = ?')
      .bind('https://example.com/a')
      .first<{ label: string }>();
    expect(row!.label).toBe('holiday');
  });

  it('clears a label with null', async () => {
    await updateLabel(env.DB, 'https://example.com/a', P, 'holiday');
    await updateLabel(env.DB, 'https://example.com/a', P, null);
    const row = await env.DB
      .prepare('SELECT label FROM urls WHERE url = ?')
      .bind('https://example.com/a')
      .first<{ label: string | null }>();
    expect(row!.label).toBeNull();
  });

  it('returns distinct labels sorted', async () => {
    await updateLabel(env.DB, 'https://example.com/a', P, 'holiday');
    await updateLabel(env.DB, 'https://example.com/b', P, 'category');
    await updateLabel(env.DB, 'https://example.com/c', P, 'holiday');
    const labels = await getDistinctLabels(env.DB, P);
    expect(labels).toEqual(['category', 'holiday']);
  });

  it('bulk-updates all when no filter', async () => {
    const updated = await bulkUpdateLabel(env.DB, P, 'bulk-tag', {});
    expect(updated).toBe(3);
  });

  it('bulk-updates with URL search filter', async () => {
    const updated = await bulkUpdateLabel(env.DB, P, 'filtered', { q: '/a' });
    expect(updated).toBe(1);
  });

  it('bulk-updates unlabeled only', async () => {
    await updateLabel(env.DB, 'https://example.com/a', P, 'existing');
    const updated = await bulkUpdateLabel(env.DB, P, 'new-label', {
      labelFilter: '__unlabeled__',
    });
    expect(updated).toBe(2);
  });

  it('bulk-updates by existing label', async () => {
    await updateLabel(env.DB, 'https://example.com/a', P, 'old');
    await updateLabel(env.DB, 'https://example.com/b', P, 'old');
    const updated = await bulkUpdateLabel(env.DB, P, 'new', { labelFilter: 'old' });
    expect(updated).toBe(2);
  });
});

describe('db — getUrlsToCheck', () => {
  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
    await upsertUrls(env.DB, P, [
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);
  });

  it('returns unchecked URLs first', async () => {
    await updateInspection(env.DB, 'https://example.com/b', {
      indexStatus: 'PASS',
      coverageState: '',
      lastCrawlTime: null,
      crawlStatus: '',
      pageFetchState: '',
      robotsStatus: '',
    });

    const urls = await getUrlsToCheck(env.DB, P, 10);
    expect(urls[0]).not.toBe('https://example.com/b');
    expect(urls).toContain('https://example.com/b');
  });

  it('respects the limit', async () => {
    const urls = await getUrlsToCheck(env.DB, P, 2);
    expect(urls.length).toBe(2);
  });
});

describe('db — getStats', () => {
  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
    await upsertUrls(env.DB, P, [
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);
  });

  it('reports correct initial stats', async () => {
    const stats = await getStats(env.DB, P);
    expect(stats.total).toBe(3);
    expect(stats.unchecked).toBe(3);
    expect(stats.checked).toBe(0);
    expect(stats.indexed).toBe(0);
    expect(stats.notIndexed).toBe(0);
  });

  it('reports correct stats after inspections', async () => {
    await updateInspection(env.DB, 'https://example.com/a', {
      indexStatus: 'PASS',
      coverageState: '',
      lastCrawlTime: null,
      crawlStatus: '',
      pageFetchState: '',
      robotsStatus: '',
    });
    await updateInspection(env.DB, 'https://example.com/b', {
      indexStatus: 'NEUTRAL',
      coverageState: '',
      lastCrawlTime: null,
      crawlStatus: '',
      pageFetchState: '',
      robotsStatus: '',
    });

    const stats = await getStats(env.DB, P);
    expect(stats.checked).toBe(2);
    expect(stats.unchecked).toBe(1);
    expect(stats.indexed).toBe(1);
    expect(stats.notIndexed).toBe(1);
  });

  it('does not include URLs from other properties', async () => {
    await upsertUrls(env.DB, 'other-prop', ['https://other.com/x']);
    const stats = await getStats(env.DB, P);
    expect(stats.total).toBe(3);
  });
});

describe('db — getUrls (filtering + pagination)', () => {
  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
    await upsertUrls(env.DB, P, [
      'https://example.com/holiday/christmas',
      'https://example.com/holiday/easter',
      'https://example.com/category/animals',
    ]);
    await updateLabel(env.DB, 'https://example.com/holiday/christmas', P, 'holiday');
    await updateLabel(env.DB, 'https://example.com/holiday/easter', P, 'holiday');
    await updateInspection(env.DB, 'https://example.com/holiday/christmas', {
      indexStatus: 'PASS',
      coverageState: 'Submitted and indexed',
      lastCrawlTime: '2026-02-26T10:00:00Z',
      crawlStatus: 'DESKTOP',
      pageFetchState: 'SUCCESSFUL',
      robotsStatus: 'ALLOWED',
    });
  });

  it('returns all URLs with no filter', async () => {
    const { total } = await getUrls(env.DB, P, {});
    expect(total).toBe(3);
  });

  it('filters by search query', async () => {
    const { total } = await getUrls(env.DB, P, { q: 'holiday' });
    expect(total).toBe(2);
  });

  it('filters by index status', async () => {
    const { urls, total } = await getUrls(env.DB, P, { status: 'PASS' });
    expect(total).toBe(1);
    expect(urls[0].url).toBe('https://example.com/holiday/christmas');
  });

  it('filters by unchecked', async () => {
    const { total } = await getUrls(env.DB, P, { status: 'unchecked' });
    expect(total).toBe(2);
  });

  it('filters by label', async () => {
    const { urls, total } = await getUrls(env.DB, P, { labelFilter: 'holiday' });
    expect(total).toBe(2);
    expect(urls.every((u) => u.label === 'holiday')).toBe(true);
  });

  it('filters by unlabeled', async () => {
    const { total } = await getUrls(env.DB, P, { labelFilter: '__unlabeled__' });
    expect(total).toBe(1);
  });

  it('paginates correctly', async () => {
    const { urls, total } = await getUrls(env.DB, P, { perPage: 2, page: 1 });
    expect(total).toBe(3);
    expect(urls.length).toBe(2);
    const page2 = await getUrls(env.DB, P, { perPage: 2, page: 2 });
    expect(page2.urls.length).toBe(1);
  });

  it('sorts by URL ascending', async () => {
    const { urls } = await getUrls(env.DB, P, { sort: 'url', dir: 'asc' });
    const sorted = [...urls].sort((a, b) => a.url.localeCompare(b.url));
    expect(urls.map((u) => u.url)).toEqual(sorted.map((u) => u.url));
  });

  it('includes label in results', async () => {
    const { urls } = await getUrls(env.DB, P, {});
    const christmas = urls.find((u) => u.url.includes('christmas'));
    expect(christmas?.label).toBe('holiday');
  });
});

describe('db — recordRun + getRuns', () => {
  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
  });

  it('records and retrieves a run', async () => {
    await recordRun(env.DB, P, '2026-02-26T10:00:00Z', '2026-02-26T10:05:00Z', 42, 30, 10, 2);
    const runs = await getRuns(env.DB, P);
    expect(runs.length).toBe(1);
    expect(runs[0].urls_checked).toBe(42);
    expect(runs[0].urls_indexed).toBe(30);
  });

  it('returns runs newest first', async () => {
    await recordRun(env.DB, P, '2026-02-25T10:00:00Z', '2026-02-25T10:05:00Z', 10, 5, 3, 2);
    await recordRun(env.DB, P, '2026-02-26T10:00:00Z', '2026-02-26T10:05:00Z', 20, 15, 3, 2);
    const runs = await getRuns(env.DB, P);
    expect(runs[0].urls_checked).toBe(20);
  });

  it('filters runs by property', async () => {
    await recordRun(env.DB, P, '2026-02-26T10:00:00Z', '2026-02-26T10:05:00Z', 10, 5, 3, 2);
    await recordRun(env.DB, 'other-prop', '2026-02-26T10:00:00Z', '2026-02-26T10:05:00Z', 20, 15, 3, 2);
    const runs = await getRuns(env.DB, P);
    expect(runs.length).toBe(1);
  });
});

describe('db — indexing submission backoff', () => {
  const P = TEST_PROPERTY_ID;

  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
    await upsertUrls(env.DB, P, ['https://example.com/page1']);
    // Make the URL eligible for submission (coverage unknown)
    await updateInspection(env.DB, 'https://example.com/page1', {
      indexStatus: 'NEUTRAL',
      coverageState: 'URL is unknown to Google',
      lastCrawlTime: null,
      crawlStatus: '',
      pageFetchState: '',
      robotsStatus: '',
    });
  });

  it('returns eligible URLs with no prior submissions', async () => {
    const urls = await getUrlsToSubmit(env.DB, P, 10);
    expect(urls.length).toBe(1);
    expect(urls[0].url).toBe('https://example.com/page1');
    expect(urls[0].type).toBe('URL_UPDATED');
  });

  it('recordIndexingSubmission increments submit count', async () => {
    await recordIndexingSubmission(env.DB, 'https://example.com/page1');
    const row = await env.DB
      .prepare('SELECT indexing_submit_count, indexing_submitted_at FROM urls WHERE url = ?')
      .bind('https://example.com/page1')
      .first<{ indexing_submit_count: number; indexing_submitted_at: string }>();
    expect(row!.indexing_submit_count).toBe(1);
    expect(row!.indexing_submitted_at).toBeTruthy();
  });

  it('has no lifetime cap: high-count URLs still retry once their backoff elapses', async () => {
    // count=3 → cooldown 28 days; submitted years ago, no change signal →
    // still eligible (the doubling ladder retires URLs gradually, not hard).
    await env.DB
      .prepare('UPDATE urls SET indexing_submit_count = 3, indexing_submitted_at = ? WHERE url = ?')
      .bind('2020-01-01T00:00:00Z', 'https://example.com/page1')
      .run();
    const urls = await getUrlsToSubmit(env.DB, P, 10);
    expect(urls.length).toBe(1);
  });

  it('skips URLs within backoff window', async () => {
    // count=2 → cooldown = 14 days. Set submitted_at to 8 days ago.
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB
      .prepare('UPDATE urls SET indexing_submit_count = 2, indexing_submitted_at = ? WHERE url = ?')
      .bind(eightDaysAgo, 'https://example.com/page1')
      .run();
    const urls = await getUrlsToSubmit(env.DB, P, 10);
    // 8 days < 14 day cooldown → should be skipped
    expect(urls.length).toBe(0);
  });

  it('returns URLs past their backoff window', async () => {
    // count=2 → cooldown = 14 days. Set submitted_at to 15 days ago.
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB
      .prepare('UPDATE urls SET indexing_submit_count = 2, indexing_submitted_at = ? WHERE url = ?')
      .bind(fifteenDaysAgo, 'https://example.com/page1')
      .run();
    const urls = await getUrlsToSubmit(env.DB, P, 10);
    expect(urls.length).toBe(1);
  });

  it('skips resubmission when the page has not changed since the last submission', async () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
    // Past the 7-day cooldown (submitted 10 days ago), but lastmod predates
    // the submission → Google already saw this version; don't resubmit.
    await env.DB
      .prepare('UPDATE urls SET indexing_submit_count = 1, indexing_submitted_at = ?, sitemap_lastmod = ? WHERE url = ?')
      .bind(daysAgo(10), daysAgo(20), 'https://example.com/page1')
      .run();
    const urls = await getUrlsToSubmit(env.DB, P, 10);
    expect(urls.length).toBe(0);
  });

  it('resubmits when sitemap lastmod advanced past the last submission', async () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
    // Past cooldown AND the page changed after the submission → eligible again.
    await env.DB
      .prepare('UPDATE urls SET indexing_submit_count = 1, indexing_submitted_at = ?, sitemap_lastmod = ? WHERE url = ?')
      .bind(daysAgo(10), daysAgo(2), 'https://example.com/page1')
      .run();
    const urls = await getUrlsToSubmit(env.DB, P, 10);
    expect(urls.length).toBe(1);
    expect(urls[0].type).toBe('URL_UPDATED');
  });

  it('treats sitemap lastmod newer than last crawl as stale (no scrape needed)', async () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
    await upsertUrls(env.DB, P, [{ url: 'https://example.com/page2', lastmod: daysAgo(1) }]);
    // Indexed page, never submitted, no scraped content date — lastmod alone
    // newer than Google's crawl marks it stale.
    await env.DB
      .prepare(`UPDATE urls SET coverage_state = 'Submitted and indexed', last_checked_at = ?, last_crawl_time = ? WHERE url = ?`)
      .bind(daysAgo(3), daysAgo(5), 'https://example.com/page2')
      .run();
    const urls = await getUrlsToSubmit(env.DB, P, 10);
    const page2 = urls.find((u) => u.url === 'https://example.com/page2');
    expect(page2?.type).toBe('URL_UPDATED');
  });

  it('a lastmod advance resets the attempt counter (fresh budget per version)', async () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
    // Heavily-retried URL: count=5 → cooldown 7×2^4 = 112 days, submitted 10
    // days ago → blocked on the ladder…
    await env.DB
      .prepare('UPDATE urls SET indexing_submit_count = 5, indexing_submitted_at = ?, sitemap_lastmod = ? WHERE url = ?')
      .bind(daysAgo(10), daysAgo(30), 'https://example.com/page1')
      .run();
    expect((await getUrlsToSubmit(env.DB, P, 10)).length).toBe(0);

    // …until the sitemap declares a newer version: count resets to 0, so the
    // baseline 7-day cooldown applies (10 days elapsed → eligible).
    await upsertUrls(env.DB, P, [{ url: 'https://example.com/page1', lastmod: daysAgo(1) }]);
    const row = await env.DB
      .prepare('SELECT indexing_submit_count FROM urls WHERE url = ?')
      .bind('https://example.com/page1')
      .first<{ indexing_submit_count: number }>();
    expect(row!.indexing_submit_count).toBe(0);
    expect((await getUrlsToSubmit(env.DB, P, 10)).length).toBe(1);
  });

  it('syncContentUpdatedDates is advance-only and resets the counter on advance', async () => {
    await env.DB
      .prepare('UPDATE urls SET indexing_submit_count = 2, content_updated_at = ? WHERE url = ?')
      .bind('2026-07-05T00:00:00.000Z', 'https://example.com/page1')
      .run();

    // Older date → no-op (date and count untouched)
    await syncContentUpdatedDates(env.DB, new Map([['https://example.com/page1', '2026-07-01T00:00:00.000Z']]));
    let row = await env.DB
      .prepare('SELECT content_updated_at, indexing_submit_count FROM urls WHERE url = ?')
      .bind('https://example.com/page1')
      .first<{ content_updated_at: string; indexing_submit_count: number }>();
    expect(row!.content_updated_at).toBe('2026-07-05T00:00:00.000Z');
    expect(row!.indexing_submit_count).toBe(2);

    // Newer date → advances and resets the budget
    await syncContentUpdatedDates(env.DB, new Map([['https://example.com/page1', '2026-07-10T00:00:00.000Z']]));
    row = await env.DB
      .prepare('SELECT content_updated_at, indexing_submit_count FROM urls WHERE url = ?')
      .bind('https://example.com/page1')
      .first<{ content_updated_at: string; indexing_submit_count: number }>();
    expect(row!.content_updated_at).toBe('2026-07-10T00:00:00.000Z');
    expect(row!.indexing_submit_count).toBe(0);
  });

  it('upsertUrls only ever advances sitemap_lastmod', async () => {
    const read = () =>
      env.DB.prepare('SELECT sitemap_lastmod FROM urls WHERE url = ?')
        .bind('https://example.com/page1')
        .first<{ sitemap_lastmod: string | null }>();

    await upsertUrls(env.DB, P, [{ url: 'https://example.com/page1', lastmod: '2026-07-05T00:00:00.000Z' }]);
    expect((await read())!.sitemap_lastmod).toBe('2026-07-05T00:00:00.000Z');

    // Older value and missing value are both ignored
    await upsertUrls(env.DB, P, [{ url: 'https://example.com/page1', lastmod: '2026-07-01T00:00:00.000Z' }]);
    await upsertUrls(env.DB, P, ['https://example.com/page1']);
    expect((await read())!.sitemap_lastmod).toBe('2026-07-05T00:00:00.000Z');

    // Newer value advances
    await upsertUrls(env.DB, P, [{ url: 'https://example.com/page1', lastmod: '2026-07-10T00:00:00.000Z' }]);
    expect((await read())!.sitemap_lastmod).toBe('2026-07-10T00:00:00.000Z');
  });

  it('updateInspection resets count when URL becomes indexed', async () => {
    // Set count to 2
    await env.DB
      .prepare('UPDATE urls SET indexing_submit_count = 2, indexing_submitted_at = ? WHERE url = ?')
      .bind(new Date().toISOString(), 'https://example.com/page1')
      .run();

    // Now it gets indexed
    await updateInspection(env.DB, 'https://example.com/page1', {
      indexStatus: 'PASS',
      coverageState: 'Submitted and indexed',
      lastCrawlTime: new Date().toISOString(),
      crawlStatus: 'DESKTOP',
      pageFetchState: 'SUCCESSFUL',
      robotsStatus: 'ALLOWED',
    });

    const row = await env.DB
      .prepare('SELECT indexing_submit_count, indexing_submitted_at FROM urls WHERE url = ?')
      .bind('https://example.com/page1')
      .first<{ indexing_submit_count: number; indexing_submitted_at: string | null }>();
    expect(row!.indexing_submit_count).toBe(0);
    expect(row!.indexing_submitted_at).toBeNull();
  });

  it('does not reset count for non-PASS inspection', async () => {
    await env.DB
      .prepare('UPDATE urls SET indexing_submit_count = 2, indexing_submitted_at = ? WHERE url = ?')
      .bind(new Date().toISOString(), 'https://example.com/page1')
      .run();

    await updateInspection(env.DB, 'https://example.com/page1', {
      indexStatus: 'NEUTRAL',
      coverageState: 'Discovered - currently not indexed',
      lastCrawlTime: null,
      crawlStatus: '',
      pageFetchState: '',
      robotsStatus: '',
    });

    const row = await env.DB
      .prepare('SELECT indexing_submit_count, indexing_submitted_at FROM urls WHERE url = ?')
      .bind('https://example.com/page1')
      .first<{ indexing_submit_count: number; indexing_submitted_at: string | null }>();
    expect(row!.indexing_submit_count).toBe(2);
    expect(row!.indexing_submitted_at).toBeTruthy();
  });
});

describe('db — getPathTraffic', () => {
  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
    await env.DB.prepare('DELETE FROM sessions').run();
    await env.DB.prepare('DELETE FROM pageviews').run();
    await env.DB.prepare('DELETE FROM pageview_daily').run();
  });

  async function insertSession(id: string, propertyId: string, startedAt: string) {
    await env.DB
      .prepare(
        `INSERT INTO sessions (id, property_id, landing_page, started_at, updated_at)
         VALUES (?, ?, '/', ?, ?)`
      )
      .bind(id, propertyId, startedAt, startedAt)
      .run();
  }

  async function insertPageview(sessionId: string, propertyId: string, path: string, ts: string) {
    await env.DB
      .prepare(
        `INSERT INTO pageviews (session_id, property_id, page_path, ts) VALUES (?, ?, ?, ?)`
      )
      .bind(sessionId, propertyId, path, ts)
      .run();
  }

  function isoDaysAgo(days: number): string {
    return new Date(Date.now() - days * 86400000).toISOString();
  }

  it('returns top paths with current sessions, prevSessions, and daily breakdown', async () => {
    // Current window (last 7 days): 3 sessions on /a, 1 on /b
    await insertSession('s1', P, isoDaysAgo(0));
    await insertPageview('s1', P, '/a', isoDaysAgo(0));
    await insertSession('s2', P, isoDaysAgo(2));
    await insertPageview('s2', P, '/a', isoDaysAgo(2));
    await insertSession('s3', P, isoDaysAgo(2));
    await insertPageview('s3', P, '/a', isoDaysAgo(2));
    await insertSession('s4', P, isoDaysAgo(5));
    await insertPageview('s4', P, '/b', isoDaysAgo(5));

    // Prior window (8–14 days ago): 1 session on /a
    await insertSession('s5', P, isoDaysAgo(10));
    await insertPageview('s5', P, '/a', isoDaysAgo(10));

    // Outside the prev window — should be ignored
    await insertSession('s6', P, isoDaysAgo(40));
    await insertPageview('s6', P, '/a', isoDaysAgo(40));

    await rebuildPageviewRollup(env.DB, 31);
    const result = await getPathTraffic(env.DB, P, 7);

    expect(result.length).toBe(2);
    expect(result[0].path).toBe('/a');
    expect(result[0].sessions).toBe(3);
    expect(result[0].prevSessions).toBe(1);
    expect(result[0].daily.length).toBe(7);
    expect(result[0].daily.reduce((a, b) => a + b, 0)).toBe(3);

    expect(result[1].path).toBe('/b');
    expect(result[1].sessions).toBe(1);
    expect(result[1].prevSessions).toBe(0);
    expect(result[1].daily.length).toBe(7);
  });

  it('counts distinct sessions, not pageviews', async () => {
    await insertSession('s1', P, isoDaysAgo(1));
    await insertPageview('s1', P, '/a', isoDaysAgo(1));
    await insertPageview('s1', P, '/a', isoDaysAgo(1));
    await insertPageview('s1', P, '/a', isoDaysAgo(1));

    await rebuildPageviewRollup(env.DB, 31);
    const result = await getPathTraffic(env.DB, P, 7);
    expect(result[0].sessions).toBe(1);
  });

  it('scopes by property_id', async () => {
    await insertSession('s1', P, isoDaysAgo(1));
    await insertPageview('s1', P, '/a', isoDaysAgo(1));
    await insertSession('s2', 'other-prop', isoDaysAgo(1));
    await insertPageview('s2', 'other-prop', '/a', isoDaysAgo(1));

    await rebuildPageviewRollup(env.DB, 31);
    const result = await getPathTraffic(env.DB, P, 7);
    expect(result.length).toBe(1);
    expect(result[0].sessions).toBe(1);
  });

  it('returns empty array when no data', async () => {
    await rebuildPageviewRollup(env.DB, 31);
    const result = await getPathTraffic(env.DB, P, 7);
    expect(result).toEqual([]);
  });

  it('rollup rebuild is idempotent (upsert, not accumulate)', async () => {
    await insertSession('s1', P, isoDaysAgo(1));
    await insertPageview('s1', P, '/a', isoDaysAgo(1));

    await rebuildPageviewRollup(env.DB, 31);
    await rebuildPageviewRollup(env.DB, 31);

    const row = await env.DB
      .prepare('SELECT sessions, views FROM pageview_daily WHERE property_id = ? AND page_path = ?')
      .bind(P, '/a')
      .first<{ sessions: number; views: number }>();
    expect(row).toEqual({ sessions: 1, views: 1 });
  });
});

