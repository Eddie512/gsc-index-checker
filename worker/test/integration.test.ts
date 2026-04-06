/**
 * Integration tests for the Worker HTTP routes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
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
