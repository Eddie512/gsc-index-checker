/**
 * Tests for sitemap.ts — XML tag extraction, sitemap index and direct sitemap support.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('sitemap — getAllUrlsFromSitemap', () => {
  const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.test.com/sitemap-0.xml</loc></sitemap>
  <sitemap><loc>https://www.test.com/sitemap-1.xml</loc></sitemap>
</sitemapindex>`;

  const sitemap0 = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.test.com/</loc></url>
  <url><loc>https://www.test.com/about</loc></url>
</urlset>`;

  const sitemap1 = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.test.com/holiday/christmas</loc></url>
</urlset>`;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('sitemap-index.xml')) {
        return new Response(sitemapIndex, { status: 200 });
      }
      if (url.includes('sitemap-0.xml')) {
        return new Response(sitemap0, { status: 200 });
      }
      if (url.includes('sitemap-1.xml')) {
        return new Response(sitemap1, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses all URLs from a sitemap index with sub-sitemaps', async () => {
    const { getAllUrlsFromSitemap } = await import('../src/sitemap');
    const urls = await getAllUrlsFromSitemap('https://www.test.com/sitemap-index.xml');

    expect(urls).toHaveLength(3);
    expect(urls).toContain('https://www.test.com/');
    expect(urls).toContain('https://www.test.com/about');
    expect(urls).toContain('https://www.test.com/holiday/christmas');
  });

  it('parses URLs from a direct sitemap (no index)', async () => {
    const { getAllUrlsFromSitemap } = await import('../src/sitemap');
    const urls = await getAllUrlsFromSitemap('https://www.test.com/sitemap-0.xml');

    expect(urls).toHaveLength(2);
    expect(urls).toContain('https://www.test.com/');
    expect(urls).toContain('https://www.test.com/about');
  });

  it('calls fetch for the sitemap index and each sub-sitemap', async () => {
    const { getAllUrlsFromSitemap } = await import('../src/sitemap');
    await getAllUrlsFromSitemap('https://www.test.com/sitemap-index.xml');

    expect(fetch).toHaveBeenCalledTimes(3); // index + 2 sitemaps
  });

  it('handles sub-sitemap fetch failure gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('sitemap-index.xml')) {
        return new Response(sitemapIndex, { status: 200 });
      }
      if (url.includes('sitemap-0.xml')) {
        return new Response(sitemap0, { status: 200 });
      }
      // sitemap-1 fails
      return new Response('Server Error', { status: 500 });
    }));

    const { getAllUrlsFromSitemap } = await import('../src/sitemap');
    const urls = await getAllUrlsFromSitemap('https://www.test.com/sitemap-index.xml');

    // Should still get URLs from sitemap-0
    expect(urls).toHaveLength(2);
    expect(urls).toContain('https://www.test.com/');
  });

  it('throws when sitemap fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Not found', { status: 404 })
    ));

    const { getAllUrlsFromSitemap } = await import('../src/sitemap');
    await expect(
      getAllUrlsFromSitemap('https://www.example.com/sitemap.xml')
    ).rejects.toThrow('Failed to fetch sitemap');
  });
});
