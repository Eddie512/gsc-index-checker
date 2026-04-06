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

  it('skips URLs at max submissions (count >= 3)', async () => {
    // Manually set count to 3
    await env.DB
      .prepare('UPDATE urls SET indexing_submit_count = 3, indexing_submitted_at = ? WHERE url = ?')
      .bind('2020-01-01T00:00:00Z', 'https://example.com/page1')
      .run();
    const urls = await getUrlsToSubmit(env.DB, P, 10);
    expect(urls.length).toBe(0);
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

