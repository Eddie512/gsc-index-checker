/**
 * Integration tests for the Worker HTTP routes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker, { pickPropertyToInspect } from '../src/index';
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

    // Wipe the underlying pageviews. A fresh aggregation would now return [].
    await env.DB.prepare('DELETE FROM pageviews').run();

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
