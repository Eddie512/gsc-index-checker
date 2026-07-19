/**
 * Integration tests for the Worker HTTP routes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker, { pickPropertyToInspect, runIndexingSubmissions } from '../src/index';
import { rebuildPageviewRollup } from '../src/db';
import { initDb, cleanDb } from './helpers';

async function seedUrls(): Promise<void> {
  const now = new Date().toISOString();
  const urls = [
    'https://www.test.com/',
    'https://www.test.com/about',
    'https://www.test.com/holiday/christmas',
  ];
  for (const url of urls) {
    await env.DB
      .prepare('INSERT OR IGNORE INTO urls (url, property_id, first_seen_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(url, 'test-prop', now, now)
      .run();
  }
}

describe('Worker HTTP routes', () => {
  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
    await seedUrls();
  });

  it('GET / returns dashboard HTML', async () => {
    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/');
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Index Checker');
    expect(html).toContain('Total URLs');
  });

  it('GET / with q filter shows filtered results', async () => {
    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/?q=christmas');
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    const html = await response.text();
    expect(html).toContain('1 results');
    expect(html).toContain('/holiday/christmas');
  });

  it('GET /runs returns run history page', async () => {
    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/runs');
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Run History');
  });

  it('GET /export returns CSV', async () => {
    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/export');
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    const csv = await response.text();
    expect(csv).toContain('URL,Index Status');
    expect(csv).toContain('test.com');
  });

  it('returns 404 for unknown routes', async () => {
    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/nonexistent');
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
  });
});

describe('Worker /api/traffic', () => {
  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
    await env.DB.prepare('DELETE FROM sessions').run();
    await env.DB.prepare('DELETE FROM pageviews').run();
    const ts = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO sessions (id, property_id, landing_page, started_at, updated_at)
         VALUES ('s1', 'test-prop', '/', ?, ?)`
      )
      .bind(ts, ts)
      .run();
    await env.DB
      .prepare(
        `INSERT INTO pageviews (session_id, property_id, page_path, ts) VALUES ('s1', 'test-prop', '/about', ?)`
      )
      .bind(ts)
      .run();
    // /api/traffic reads the rollup, not raw pageviews
    await env.DB.prepare('DELETE FROM pageview_daily').run();
    await rebuildPageviewRollup(env.DB);
  });

  it('returns traffic data with CORS headers', async () => {
    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/api/traffic?property=test-prop&days=7', {
      headers: { Origin: 'https://www.test.com' },
    });
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const data = (await response.json()) as Array<{
      path: string; sessions: number; prevSessions: number; daily: number[];
    }>;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].path).toBe('/about');
    expect(data[0].sessions).toBe(1);
    expect(data[0].daily.length).toBe(7);
  });

  it('returns 400 when property is missing', async () => {
    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/api/traffic?days=7');
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(400);
  });

  it('returns 404 for unknown property', async () => {
    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/api/traffic?property=nope&days=7');
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(404);
  });

  it('clamps days to a valid range', async () => {
    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/api/traffic?property=test-prop&days=999');
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    const data = (await response.json()) as Array<{ daily: number[] }>;
    expect(data[0].daily.length).toBe(15);
  });

  it('serves a cached response for repeat requests (no re-scan)', async () => {
    // First request populates the edge cache.
    const ctx1 = createExecutionContext();
    const first = await worker.fetch(
      new Request('https://gsc.test/api/traffic?property=test-prop&days=7'),
      env as any,
      ctx1
    );
    await waitOnExecutionContext(ctx1); // flush the waitUntil cache.put
    expect(((await first.json()) as unknown[]).length).toBe(1);

    // Wipe the underlying data (raw and rollup). A fresh read would now
    // return [].
    await env.DB.prepare('DELETE FROM pageviews').run();
    await env.DB.prepare('DELETE FROM pageview_daily').run();

    // Same params → served from cache, so it still reflects the pre-delete data
    // instead of re-scanning D1.
    const ctx2 = createExecutionContext();
    const second = await worker.fetch(
      new Request('https://gsc.test/api/traffic?property=test-prop&days=7'),
      env as any,
      ctx2
    );
    await waitOnExecutionContext(ctx2);
    const data = (await second.json()) as Array<{ path: string; sessions: number }>;
    expect(data.length).toBe(1);
    expect(data[0].path).toBe('/about');
  });
});

describe('Worker label API', () => {
  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
    await seedUrls();
  });

  it('POST /api/label sets a label', async () => {
    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/api/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.test.com/',
        label: 'homepage',
      }),
    });
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = (await response.json()) as { ok: boolean };
    expect(data.ok).toBe(true);

    const row = await env.DB
      .prepare('SELECT label FROM urls WHERE url = ?')
      .bind('https://www.test.com/')
      .first<{ label: string }>();
    expect(row!.label).toBe('homepage');
  });

  it('POST /api/label clears a label with null', async () => {
    await env.DB
      .prepare('UPDATE urls SET label = ? WHERE url = ?')
      .bind('old-label', 'https://www.test.com/')
      .run();

    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/api/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.test.com/',
        label: null,
      }),
    });
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    const row = await env.DB
      .prepare('SELECT label FROM urls WHERE url = ?')
      .bind('https://www.test.com/')
      .first<{ label: string | null }>();
    expect(row!.label).toBeNull();
  });

  it('POST /api/bulk-label applies to filtered URLs', async () => {
    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/api/bulk-label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'site-page', q: '/holiday/' }),
    });
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    const data = (await response.json()) as { ok: boolean; updated: number };
    expect(data.ok).toBe(true);
    expect(data.updated).toBe(1);
  });

  it('POST /api/bulk-label with no filter updates all', async () => {
    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/api/bulk-label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'all-pages' }),
    });
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    const data = (await response.json()) as { updated: number };
    expect(data.updated).toBe(3);
  });

  it('label filter works in dashboard', async () => {
    await env.DB
      .prepare('UPDATE urls SET label = ? WHERE url = ?')
      .bind('holiday', 'https://www.test.com/holiday/christmas')
      .run();

    const ctx = createExecutionContext();
    const request = new Request('https://gsc.test/?label=holiday');
    const response = await worker.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);

    const html = await response.text();
    expect(html).toContain('1 results');
    expect(html).toContain('/holiday/christmas');
  });
});

describe('Worker crawler guard', () => {
  const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
  });

  it('serves a deny-all robots.txt', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request('https://gsc.test/robots.txt'), env as any, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Disallow: /');
  });

  it('blocks crawlers from dashboard pages', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://gsc.test/journeys', { headers: { 'User-Agent': BOT_UA } }),
      env as any,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(403);
  });

  it('still serves /api/traffic to any user agent', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://gsc.test/api/traffic?property=test-prop&days=7', {
        headers: { 'User-Agent': BOT_UA },
      }),
      env as any,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
  });

  it('serves dashboard pages to normal browsers', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://gsc.test/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15' },
      }),
      env as any,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
  });
});

describe('Worker /sync manual sitemap crawl', () => {
  const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.test.com/</loc><lastmod>2026-07-10T00:00:00.000Z</lastmod></url>
  <url><loc>https://www.test.com/new-page</loc></url>
</urlset>`;

  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: string | Request) => {
      const u = typeof input === 'string' ? input : input.url;
      if (u.includes('sitemap')) return new Response(SITEMAP_XML, { status: 200 });
      return new Response('Not found', { status: 404 });
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('crawls the sitemap on demand and reports results', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://gsc.test/sync?property=test-prop'),
      env as any,
      ctx
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const data = (await response.json()) as Record<string, { urls_found?: number }>;
    expect(data['test-prop'].urls_found).toBe(2);

    const row = await env.DB
      .prepare('SELECT sitemap_lastmod FROM urls WHERE url = ?')
      .bind('https://www.test.com/')
      .first<{ sitemap_lastmod: string | null }>();
    expect(row!.sitemap_lastmod).toBe('2026-07-10T00:00:00.000Z');
  });

  it('returns 404 for an unknown property', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://gsc.test/sync?property=nope'),
      env as any,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(404);
  });
});

describe('runIndexingSubmissions — fair quota sharing', () => {
  // Seed a second property plus N unknown-coverage (eligible) URLs per property.
  async function seedProperty(id: string, candidates: number) {
    await env.DB
      .prepare(`INSERT OR IGNORE INTO properties (id, name, site_url, domain) VALUES (?, ?, ?, ?)`)
      .bind(id, id, `sc-domain:${id}.com`, `www.${id}.com`)
      .run();
    for (let i = 0; i < candidates; i++) {
      await env.DB
        .prepare(
          `INSERT INTO urls (url, property_id, coverage_state, first_seen_at, created_at)
           VALUES (?, ?, 'URL is unknown to Google', datetime('now'), datetime('now'))`
        )
        .bind(`https://www.${id}.com/p${i}`, id)
        .run();
    }
  }

  function fakeEnv() {
    const calls: Record<string, number> = {};
    const submit = async (url: string) => {
      const host = new URL(url).hostname;
      calls[host] = (calls[host] ?? 0) + 1;
      return { success: true };
    };
    return { calls, testEnv: { ...env, GSC_CLIENT_EMAIL: 'x', GSC_PRIVATE_KEY: 'y' } as any, submit };
  }

  beforeEach(async () => {
    await initDb(env.DB);
    await cleanDb(env.DB);
    await env.DB.prepare(`DELETE FROM properties WHERE id != 'test-prop'`).run();
    await env.DB.prepare('DELETE FROM urls').run();
  });

  it('splits a run evenly when both properties have demand', async () => {
    await seedProperty('prop-a', 20);
    await seedProperty('prop-b', 20);
    await env.DB.prepare(`DELETE FROM properties WHERE id = 'test-prop'`).run();

    const { calls, testEnv, submit } = fakeEnv();
    await runIndexingSubmissions(testEnv, submit as any, 0);

    // Batch of 10, two properties under their share → 5 each.
    expect(calls['www.prop-a.com']).toBe(5);
    expect(calls['www.prop-b.com']).toBe(5);
  });

  it('donates unused share to the property with demand', async () => {
    await seedProperty('prop-a', 20);
    await seedProperty('prop-b', 0);
    await env.DB.prepare(`DELETE FROM properties WHERE id = 'test-prop'`).run();

    const { calls, testEnv, submit } = fakeEnv();
    await runIndexingSubmissions(testEnv, submit as any, 0);

    // prop-b has nothing to submit → prop-a takes the whole batch.
    expect(calls['www.prop-a.com']).toBe(10);
    expect(calls['www.prop-b.com']).toBeUndefined();
  });

  it('counts every attempt against the quota ledger', async () => {
    await seedProperty('prop-a', 20);
    await env.DB.prepare(`DELETE FROM properties WHERE id = 'test-prop'`).run();

    const { testEnv, submit } = fakeEnv();
    await runIndexingSubmissions(testEnv, submit as any, 0);

    const row = await env.DB
      .prepare('SELECT attempts FROM indexing_quota')
      .first<{ attempts: number }>();
    expect(row!.attempts).toBe(10);
  });

  it('halts on 429 and suppresses submissions until the quota day resets', async () => {
    await seedProperty('prop-a', 20);
    await seedProperty('prop-b', 20);
    await env.DB.prepare(`DELETE FROM properties WHERE id = 'test-prop'`).run();

    let calls = 0;
    const rateLimited = async () => {
      calls++;
      return { success: false, error: '429: Quota exceeded for quota metric' };
    };
    const testEnv = { ...env, GSC_CLIENT_EMAIL: 'x', GSC_PRIVATE_KEY: 'y' } as any;

    // First 429 stops the entire run — one attempt, not a full batch.
    await runIndexingSubmissions(testEnv, rateLimited as any, 0);
    expect(calls).toBe(1);

    // The day is clamped to the full quota, so the next run doesn't submit at all.
    const row = await env.DB
      .prepare('SELECT attempts FROM indexing_quota')
      .first<{ attempts: number }>();
    expect(row!.attempts).toBe(200);

    await runIndexingSubmissions(testEnv, rateLimited as any, 0);
    expect(calls).toBe(1);

    // The outcome (including quota exhaustion) is logged as a 'submit' run.
    const activity = await env.DB
      .prepare(`SELECT details FROM check_runs WHERE run_type = 'submit' AND property_id = 'prop-a'`)
      .first<{ details: string }>();
    const details = JSON.parse(activity!.details);
    expect(details.failed).toBe(1);
    expect(details.quota_exhausted).toBe(1);
    expect(details.failures).toContain('429');
  });

  it('logs submission outcomes per property to the activity feed', async () => {
    await seedProperty('prop-a', 3);
    await env.DB.prepare(`DELETE FROM properties WHERE id = 'test-prop'`).run();

    // Two succeed, one fails with a permission error.
    let n = 0;
    const flaky = async () => {
      n++;
      return n === 2
        ? { success: false, error: '403: Permission denied on resource' }
        : { success: true };
    };
    const testEnv = { ...env, GSC_CLIENT_EMAIL: 'x', GSC_PRIVATE_KEY: 'y' } as any;
    await runIndexingSubmissions(testEnv, flaky as any, 0);

    const activity = await env.DB
      .prepare(`SELECT details FROM check_runs WHERE run_type = 'submit' AND property_id = 'prop-a'`)
      .first<{ details: string }>();
    const details = JSON.parse(activity!.details);
    expect(details.attempted).toBe(3);
    expect(details.succeeded).toBe(2);
    expect(details.failed).toBe(1);
    expect(details.failures).toContain('403');
  });

  it('a property at its daily share only receives leftovers', async () => {
    await seedProperty('prop-a', 20);
    await seedProperty('prop-b', 3);
    await env.DB.prepare(`DELETE FROM properties WHERE id = 'test-prop'`).run();
    // Mark prop-a as having already used its 100/day share (2 properties →
    // share = 100): 100 URLs submitted today.
    const now = new Date().toISOString();
    for (let i = 0; i < 100; i++) {
      await env.DB
        .prepare(
          `INSERT INTO urls (url, property_id, coverage_state, indexing_submitted_at, indexing_submit_count, first_seen_at, created_at)
           VALUES (?, 'prop-a', 'URL is unknown to Google', ?, 1, datetime('now'), datetime('now'))`
        )
        .bind(`https://www.prop-a.com/used${i}`, now)
        .run();
    }

    const { calls, testEnv, submit } = fakeEnv();
    await runIndexingSubmissions(testEnv, submit as any, 0);

    // Round 1: only prop-b is under its share → its 3 candidates.
    // Round 2: leftovers go to prop-a despite being at its share.
    expect(calls['www.prop-b.com']).toBe(3);
    expect(calls['www.prop-a.com']).toBe(7);
  });
});

describe('pickPropertyToInspect', () => {
  const now = Date.parse('2026-07-11T12:00:00.000Z');
  const iso = (minAgo: number) => new Date(now - minAgo * 60000).toISOString();
  const runs = (e: Record<string, string | null>) => new Map(Object.entries(e));
  const errs = (e: Record<string, number>) => new Map(Object.entries(e));

  it('prefers a never-inspected property', () => {
    // 'b' has no last-run entry → sorts ahead of the recently-run 'a'.
    expect(pickPropertyToInspect(['a', 'b'], runs({ a: iso(60) }), errs({}), now)).toBe('b');
  });

  it('picks the least-recently-inspected when all have run', () => {
    const last = runs({ a: iso(10), b: iso(120), c: iso(30) });
    expect(pickPropertyToInspect(['a', 'b', 'c'], last, errs({}), now)).toBe('b');
  });

  it('skips a property inside its error backoff, picks the next eligible', () => {
    // 'a' is least-recent but errored 3× → backoff 7*2^2=28min; ran 10min ago → skip.
    const last = runs({ a: iso(10), b: iso(5) });
    expect(pickPropertyToInspect(['a', 'b'], last, errs({ a: 3 }), now)).toBe('b');
  });

  it('re-picks a backed-off property once enough time has passed', () => {
    // 'a' errored once → backoff 7min; ran 8min ago → eligible again.
    expect(pickPropertyToInspect(['a'], runs({ a: iso(8) }), errs({ a: 1 }), now)).toBe('a');
  });

  it('returns null when every property is inside its backoff', () => {
    // streak 5 → backoff capped at 60min; ran 1min ago → still backing off.
    expect(pickPropertyToInspect(['a'], runs({ a: iso(1) }), errs({ a: 5 }), now)).toBeNull();
  });
});
