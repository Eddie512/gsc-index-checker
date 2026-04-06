/**
 * Content date detection — scrapes pages for last-modified dates.
 *
 * Every sync run, fetches a batch of pages and extracts dates from
 * HTTP headers and HTML meta tags.
 *
 * Detection (in priority order):
 *   1. HTTP Last-Modified header
 *   2. <meta property="article:modified_time">
 *   3. <meta property="og:updated_time">
 *   4. <meta name="last-modified">
 *   5. <meta name="dcterms.modified">
 *   6. <meta itemprop="dateModified">
 *   7. JSON-LD dateModified in <script type="application/ld+json">
 */

import { sleep } from './lib/utils';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Meta tag patterns (property="..." content="..." in either order)
// ---------------------------------------------------------------------------

function metaPatterns(attr: 'property' | 'name' | 'itemprop', value: string): RegExp[] {
  const v = value.replace('.', '\\.');
  return [
    new RegExp(`<meta\\s+${attr}\\s*=\\s*["']${v}["']\\s+content\\s*=\\s*["']([^"']+)["']`, 'i'),
    new RegExp(`<meta\\s+content\\s*=\\s*["']([^"']+)["']\\s+${attr}\\s*=\\s*["']${v}["']`, 'i'),
  ];
}

const META_PATTERNS = [
  ...metaPatterns('property', 'article:modified_time'),
  ...metaPatterns('property', 'og:updated_time'),
  ...metaPatterns('name', 'last-modified'),
  ...metaPatterns('name', 'dcterms.modified'),
  ...metaPatterns('itemprop', 'dateModified'),
];

// JSON-LD dateModified
const JSONLD_PATTERN = /"dateModified"\s*:\s*"([^"]+)"/;

/** How many pages to scrape per sync run. */
export const CONTENT_SCRAPE_BATCH = 25;

/** Delay between fetches (ms). */
const SCRAPE_DELAY_MS = 300;

/**
 * Try to parse a date string. Returns ISO string or null.
 */
function parseDate(raw: string): string | null {
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString();
  // Accept raw strings that look like dates (YYYY-MM-DD...)
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(raw)) return raw;
  return null;
}

/**
 * Extract last-modified date from a page's HTML and HTTP headers.
 */
function extractDate(html: string, headers: Headers): string | null {
  // 1. HTTP Last-Modified header
  const lastMod = headers.get('last-modified');
  if (lastMod) {
    const d = parseDate(lastMod);
    if (d) return d;
  }

  // Only scan the <head> portion for meta tags
  const headEnd = html.indexOf('</head>');
  const headHtml = headEnd > 0 ? html.slice(0, headEnd + 7) : html.slice(0, 15000);

  // 2. Meta tags
  for (const pattern of META_PATTERNS) {
    const match = headHtml.match(pattern);
    if (match?.[1]) {
      const d = parseDate(match[1]);
      if (d) return d;
    }
  }

  // 3. JSON-LD in <script type="application/ld+json"> blocks
  const ldMatches = html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of ldMatches) {
    const jsonBlock = m[1];
    const dateMatch = jsonBlock.match(JSONLD_PATTERN);
    if (dateMatch?.[1]) {
      const d = parseDate(dateMatch[1]);
      if (d) return d;
    }
  }

  return null;
}

/**
 * Stats returned from a scrape batch.
 */
export interface ScrapeStats {
  scraped: number;
  datesFound: number;
  skipped: number;
  errors: number;
}

/**
 * Scrape a batch of URLs and return a map of URL → lastUpdated date.
 */
export async function scrapeContentDates(
  urls: string[]
): Promise<{ dateMap: Map<string, string>; stats: ScrapeStats }> {
  const dateMap = new Map<string, string>();
  const stats: ScrapeStats = { scraped: 0, datesFound: 0, skipped: 0, errors: 0 };

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
        redirect: 'follow',
      });

      if (!res.ok) {
        stats.skipped++;
        await sleep(SCRAPE_DELAY_MS);
        continue;
      }

      // Read up to ~50KB (some frameworks inline CSS/JS before meta tags)
      const reader = res.body?.getReader();
      if (!reader) { stats.skipped++; await sleep(SCRAPE_DELAY_MS); continue; }

      let html = '';
      let bytesRead = 0;
      const maxBytes = 50_000;

      while (bytesRead < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        html += new TextDecoder().decode(value);
        bytesRead += value.length;
      }
      reader.cancel();

      stats.scraped++;

      const date = extractDate(html, res.headers);
      if (date) {
        dateMap.set(url, date);
        stats.datesFound++;
      }
    } catch {
      stats.errors++;
    }
    await sleep(SCRAPE_DELAY_MS);
  }

  return { dateMap, stats };
}
