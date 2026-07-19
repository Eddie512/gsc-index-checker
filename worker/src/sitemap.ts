/**
 * Sitemap parser — fetches a sitemap (index or direct) and extracts all URLs
 * with their <lastmod> dates (normalized to ISO, null when absent/invalid).
 */

const USER_AGENT = 'GSCIndexChecker/1.0 (+https://github.com/anthropics/gsc-index-checker)';

export interface SitemapEntry {
  url: string;
  lastmod: string | null;
}

/** Extract text content from XML elements matching a simple tag name. */
function extractTag(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'gi');
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

/** Normalize a <lastmod> value (date-only or full timestamp) to ISO, or null. */
function normalizeLastmod(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw.trim());
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Parse <url> blocks from a urlset, pairing each <loc> with its <lastmod>. */
function extractEntries(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const blockRegex = /<url[\s>][\s\S]*?<\/url>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(xml)) !== null) {
    const block = match[0];
    const loc = /<loc[^>]*>([^<]+)<\/loc>/i.exec(block);
    if (!loc) continue;
    const lastmod = /<lastmod[^>]*>([^<]+)<\/lastmod>/i.exec(block);
    entries.push({ url: loc[1].trim(), lastmod: normalizeLastmod(lastmod?.[1]) });
  }
  if (entries.length > 0) return entries;
  // Fallback for malformed sitemaps without <url> blocks: bare <loc> tags.
  return extractTag(xml, 'loc').map((url) => ({ url, lastmod: null }));
}

/**
 * Fetch and parse a sitemap, returning all page URLs with lastmod dates.
 * Supports both sitemap index files and single sitemaps.
 */
export async function getAllUrlsFromSitemap(
  sitemapUrl: string
): Promise<SitemapEntry[]> {
  const response = await fetch(sitemapUrl, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: ${response.status}`);
  }

  const xml = await response.text();

  // Check if this is a sitemap index (contains <sitemap> elements)
  const isSitemapIndex = xml.includes('<sitemapindex');

  if (!isSitemapIndex) {
    // Direct sitemap — return the entries directly
    return extractEntries(xml);
  }

  // Sitemap index — fetch each sub-sitemap
  const allEntries: SitemapEntry[] = [];
  for (const subUrl of extractTag(xml, 'loc')) {
    try {
      const subResponse = await fetch(subUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });

      if (!subResponse.ok) continue;

      const subXml = await subResponse.text();
      allEntries.push(...extractEntries(subXml));
    } catch {
      // Skip unreachable sub-sitemaps
    }
  }

  return allEntries;
}
