import type { FC } from 'hono/jsx';

/**
 * Map a GSC coverageState string to a short, user-readable label.
 * Returns null if the coverage state is empty/unknown, so callers can fall
 * back to the raw verdict.
 */
export function shortCoverageLabel(coverage: string | null | undefined): string | null {
  if (!coverage) return null;
  const c = coverage.toLowerCase();
  if (c.includes('unknown to google')) return 'UNKNOWN TO GOOGLE';
  if (c.includes('discovered') && c.includes('not indexed')) return 'DISCOVERED';
  if (c.includes('crawled') && c.includes('not indexed')) return 'CRAWLED';
  if (c.includes('noindex')) return 'NOINDEX';
  if (c.includes('duplicate')) return 'DUPLICATE';
  if (c.includes('redirect')) return 'REDIRECT';
  if (c.includes('soft 404')) return 'SOFT 404';
  if (c.includes('not found') || c.includes('404')) return 'NOT FOUND';
  if (c.includes('blocked by robots')) return 'BLOCKED';
  if (c.includes('server error') || c.includes('5xx')) return 'SERVER ERROR';
  if (c.includes('excluded')) return 'EXCLUDED';
  return null;
}

export const Badge: FC<{ status: string | null; coverage?: string | null }> = ({ status, coverage }) => {
  if (!status) return <span class="never">—</span>;
  const title = coverage || undefined;
  if (status === 'PASS') return <span class="badge pass" title={title}>INDEXED</span>;
  if (status === 'FAIL') {
    const label = shortCoverageLabel(coverage) || 'NOT INDEXED';
    return <span class="badge fail" title={title}>{label}</span>;
  }
  if (status === 'NEUTRAL') {
    const label = shortCoverageLabel(coverage) || 'NEUTRAL';
    return <span class="badge neutral" title={title}>{label}</span>;
  }
  return <span class="badge unknown" title={title}>{status}</span>;
};
