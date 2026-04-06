/**
 * Sitemap parser — fetches a sitemap (index or direct) and extracts all URLs.
 */

const USER_AGENT = 'GSCIndexChecker/1.0 (+https://github.com/anthropics/gsc-index-checker)';

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

/**
 * Fetch and parse a sitemap, returning all page URLs.
 * Supports both sitemap index files and single sitemaps.
 */
export async function getAllUrlsFromSitemap(
  sitemapUrl: string
): Promise<string[]> {
  const response = await fetch(sitemapUrl, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: ${response.status}`);
  }

  const xml = await response.text();

  // Check if this is a sitemap index (contains <sitemap> elements)
  const sitemapUrls = extractTag(xml, 'loc');
  const isSitemapIndex = xml.includes('<sitemapindex');

  if (!isSitemapIndex) {
    // Direct sitemap — return the URLs directly
    return sitemapUrls;
  }

  // Sitemap index — fetch each sub-sitemap
  const allUrls: string[] = [];
  for (const subUrl of sitemapUrls) {
    try {
      const subResponse = await fetch(subUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });

      if (!subResponse.ok) continue;

      const subXml = await subResponse.text();
      allUrls.push(...extractTag(subXml, 'loc'));
    } catch {
      // Skip unreachable sub-sitemaps
    }
  }

  return allUrls;
}
