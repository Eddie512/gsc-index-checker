/**
 * Tests for content-api.ts — robots/noindex detection during content scraping.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { scrapeContentDates } from '../src/content-api';

function htmlPage(head: string): string {
  return `<!DOCTYPE html><html><head>${head}</head><body>hi</body></html>`;
}

describe('content-api — content date extraction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('distrusts a fresh Last-Modified header but accepts an old one; meta always wins', async () => {
    const freshHeader = new Date().toUTCString(); // ≈ render time — dynamic
    const oldHeader = new Date(Date.now() - 10 * 86400000).toUTCString();

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/dynamic-header')) {
        // famouspeople pattern: Last-Modified = now, no meta dates
        return new Response(htmlPage('<title>t</title>'), {
          status: 200,
          headers: { 'Last-Modified': freshHeader },
        });
      }
      if (url.includes('/honest-header')) {
        return new Response(htmlPage('<title>t</title>'), {
          status: 200,
          headers: { 'Last-Modified': oldHeader },
        });
      }
      if (url.includes('/meta-beats-header')) {
        return new Response(
          htmlPage('<meta property="article:modified_time" content="2026-07-01T00:00:00.000Z">'),
          { status: 200, headers: { 'Last-Modified': freshHeader } }
        );
      }
      return new Response('nope', { status: 404 });
    }));

    const { dateMap } = await scrapeContentDates([
      'https://t.com/dynamic-header',
      'https://t.com/honest-header',
      'https://t.com/meta-beats-header',
    ]);

    // Render-timestamp header → no date at all (better none than a lie)
    expect(dateMap.has('https://t.com/dynamic-header')).toBe(false);
    // A header at least a day old is a real signal
    expect(dateMap.get('https://t.com/honest-header')).toBe(new Date(oldHeader).toISOString());
    // Editorial meta date wins over any header
    expect(dateMap.get('https://t.com/meta-beats-header')).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('content-api — noindex detection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies pages by robots meta and X-Robots-Tag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/clean')) {
        return new Response(htmlPage('<meta name="robots" content="index, follow">'), { status: 200 });
      }
      if (url.includes('/meta-noindex')) {
        return new Response(htmlPage('<meta name="robots" content="noindex, nofollow">'), { status: 200 });
      }
      if (url.includes('/no-tag')) {
        return new Response(htmlPage('<title>t</title>'), { status: 200 });
      }
      if (url.includes('/header-noindex')) {
        return new Response(htmlPage('<title>t</title>'), {
          status: 200,
          headers: { 'X-Robots-Tag': 'noindex' },
        });
      }
      return new Response('nope', { status: 404 });
    }));

    const { indexableMap } = await scrapeContentDates([
      'https://t.com/clean',
      'https://t.com/meta-noindex',
      'https://t.com/no-tag',
      'https://t.com/header-noindex',
      'https://t.com/missing',
    ]);

    expect(indexableMap.get('https://t.com/clean')).toBe(true);
    expect(indexableMap.get('https://t.com/meta-noindex')).toBe(false);
    // No robots tag at all → indexable by default
    expect(indexableMap.get('https://t.com/no-tag')).toBe(true);
    expect(indexableMap.get('https://t.com/header-noindex')).toBe(false);
    // Fetch failed → absent from the map ("couldn't tell"), never assumed
    expect(indexableMap.has('https://t.com/missing')).toBe(false);
  });
});
