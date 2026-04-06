import type { FC } from 'hono/jsx';
import type { RunRow, Property, RunType } from '../db';
import { formatDate, duration } from '../lib/utils';
import { Layout } from './Layout';
import { Badge } from './Badge';

interface Props {
  runs: RunRow[];
  properties: Property[];
  currentProperty: Property | null;
}

const TYPE_LABELS: Record<RunType, string> = {
  inspect: 'Inspection',
  sync: 'Sitemap Sync',
  scrape: 'Content Scrape',
};

const TYPE_COLORS: Record<RunType, string> = {
  inspect: 'var(--green)',
  sync: '#6ea8fe',
  scrape: '#c4a5de',
};

const RunTypeBadge: FC<{ type: RunType }> = ({ type }) => (
  <span
    style={`display:inline-block;font-size:9px;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border:1px solid ${TYPE_COLORS[type]};color:${TYPE_COLORS[type]};font-weight:600`}
  >
    {TYPE_LABELS[type]}
  </span>
);

function parseDetails(details: string | null): Record<string, number | string> | null {
  if (!details) return null;
  try { return JSON.parse(details); } catch { return null; }
}

const DetailsSummary: FC<{ run: RunRow }> = ({ run }) => {
  const type = run.run_type || 'inspect';

  if (type === 'inspect') {
    const d = parseDetails(run.details);
    return (
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <span>{run.urls_checked} checked</span>
        <span><Badge status="PASS" /> {run.urls_indexed}</span>
        <span><Badge status="FAIL" /> {run.urls_not_indexed}</span>
        {run.urls_error > 0 && <span class="badge unknown">{run.urls_error} errors</span>}
        {d?.error && <span style="color:var(--red);font-size:11px;flex-basis:100%">{String(d.error).slice(0, 120)}</span>}
      </div>
    );
  }

  const d = parseDetails(run.details);
  if (!d) return <span style="color:var(--text-muted)">—</span>;

  if (d.error) {
    return <span style="color:var(--red);font-size:11px">{String(d.error).slice(0, 80)}</span>;
  }

  if (type === 'sync') {
    const parts: string[] = [];
    if (d.urls_found) parts.push(`${d.urls_found} URLs found`);
    if (d.marked_for_deletion) parts.push(`${d.marked_for_deletion} marked for deletion`);
    if (d.deleted) parts.push(`${d.deleted} removed`);
    if (d.restored) parts.push(`${d.restored} restored`);
    return <span>{parts.join(' · ') || 'no changes'}</span>;
  }

  if (type === 'scrape') {
    const parts: string[] = [];
    if (d.pages_scraped) parts.push(`${d.pages_scraped} pages scraped`);
    if (d.dates_found) parts.push(`${d.dates_found} dates found`);
    if (d.dates_synced) parts.push(`${d.dates_synced} synced`);
    return <span>{parts.join(' · ') || 'no pages to scrape'}</span>;
  }

  return <span style="color:var(--text-muted)">—</span>;
};

export const RunsPage: FC<Props> = ({ runs, properties, currentProperty }) => (
  <Layout page="runs" properties={properties} currentProperty={currentProperty}>
    <h2 style="font-size:14px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;margin-bottom:16px">
      Run History
    </h2>
    <div class="tw">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Type</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {runs.length > 0 ? (
            runs.map((r) => (
              <tr>
                <td class="dc">{r.id}</td>
                <td class="dc"><RunTypeBadge type={r.run_type || 'inspect'} /></td>
                <td class="dc">{formatDate(r.started_at)}</td>
                <td class="dc">{duration(r.started_at, r.finished_at)}</td>
                <td><DetailsSummary run={r} /></td>
              </tr>
            ))
          ) : (
            <tr>
              <td colspan={5} style="text-align:center;padding:40px;color:var(--text-muted)">
                No runs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </Layout>
);
