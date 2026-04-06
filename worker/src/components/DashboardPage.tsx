import type { FC } from 'hono/jsx';
import type { DashboardStats, UrlRow, Property } from '../db';
import { pct, escapeHtml, formatDate } from '../lib/utils';
import { Layout } from './Layout';
import { Badge } from './Badge';
import { Dropdown, type DropdownOption } from './Dropdown';

interface Props {
  stats: DashboardStats;
  urls: UrlRow[];
  totalPages: number;
  q: string;
  status: string;
  labelFilter: string;
  labels: string[];
  sort: string;
  dir: string;
  page: number;
  total: number;
  offset: number;
  properties: Property[];
  currentProperty: Property | null;
  hasData: boolean;
}

const StatsBar: FC<{ stats: DashboardStats; propertyParam: string }> = ({ stats, propertyParam }) => {
  const base = propertyParam ? `/?property=${encodeURIComponent(propertyParam)}` : '/';
  const link = (status: string) => status ? `${base}${base.includes('?') ? '&' : '?'}status=${status}` : base;
  return (
    <div class="stats">
      <a href={link('')} class="sc" style="text-decoration:none;color:inherit">
        <div class="l">Total URLs</div>
        <div class="v">{stats.total}</div>
      </a>
      <a href={link('PASS')} class="sc g" style="text-decoration:none;color:inherit">
        <div class="l">Indexed</div>
        <div class="v">{stats.indexed}</div>
        <div class="s">{pct(stats.indexed, stats.total)}%</div>
      </a>
      <a href={link('notindexed')} class="sc r" style="text-decoration:none;color:inherit">
        <div class="l">Not Indexed</div>
        <div class="v">{stats.notIndexed}</div>
        <div class="s">{pct(stats.notIndexed, stats.total)}%</div>
      </a>
      <a href={link('unchecked')} class="sc y" style="text-decoration:none;color:inherit">
        <div class="l">Unchecked</div>
        <div class="v">{stats.unchecked}</div>
        <div class="s">{pct(stats.unchecked, stats.total)}%</div>
      </a>
      <div class="sc">
        <div class="l">Checked</div>
        <div class="v">{stats.checked}</div>
        <div class="s">of {stats.total}</div>
        <div class="pb">
          <div style={`width:${pct(stats.checked, stats.total)}%`} />
        </div>
      </div>
    </div>
  );
};

const Filters: FC<{
  q: string;
  status: string;
  labelFilter: string;
  labels: string[];
  sort: string;
  dir: string;
  total: number;
  propertyParam: string;
}> = ({ q, status, labelFilter, labels, sort, dir, total, propertyParam }) => {
  const labelOpts: DropdownOption[] = [
    { value: '', label: 'All Labels' },
    { value: '__unlabeled__', label: 'Unlabeled' },
    ...labels.map((l) => ({ value: l, label: l })),
  ];

  return (
    <form method="get" class="fi">
      {propertyParam ? <input type="hidden" name="property" value={propertyParam} /> : null}
      <input type="text" name="q" placeholder="Search URLs…" value={q} />
      <Dropdown
        name="status"
        options={[
          { value: '', label: 'All Statuses' },
          { value: 'PASS', label: '✓ Indexed' },
          { value: 'notindexed', label: '✗ Not Indexed' },
          { value: 'NEUTRAL', label: '— Neutral' },
          { value: 'unchecked', label: '? Unchecked' },
        ]}
        selected={status}
      />
      <Dropdown name="label" options={labelOpts} selected={labelFilter} />
      <Dropdown
        name="sort"
        options={[
          { value: 'last_checked_at', label: 'Last Checked' },
          { value: 'last_crawl_time', label: 'Last Crawled' },
          { value: 'traffic', label: 'Traffic' },
          { value: 'content_updated_at', label: 'Last Updated' },
          { value: 'url', label: 'URL (A-Z)' },
          { value: 'index_status', label: 'Index Status' },
          { value: 'label', label: 'Label' },
        ]}
        selected={sort}
      />
      <Dropdown
        name="dir"
        options={[
          { value: 'desc', label: 'Newest First' },
          { value: 'asc', label: 'Oldest First' },
        ]}
        selected={dir}
      />
      <button type="submit">Filter</button>
      {(q || status || labelFilter) ? (
        <a class="clear" href={propertyParam ? `/?property=${encodeURIComponent(propertyParam)}` : '/'}>Clear</a>
      ) : null}
      <span class="rc">{total} results</span>
    </form>
  );
};

const UrlTable: FC<{ urls: UrlRow[]; offset: number; propertyId: string }> = ({ urls, offset, propertyId }) => {
  return (
  <div class="tw">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>URL</th>
          <th>Label</th>
          <th class="has-tip"><span class="tip" data-tip="Current Google indexing status from the URL Inspection API">Index Status</span></th>
          <th class="has-tip"><span class="tip" data-tip="When the page content was last modified, detected from meta tags (article:modified_time, og:updated_time) or JSON-LD dateModified">Last Updated</span></th>
          <th class="has-tip"><span class="tip" data-tip="When Googlebot last crawled this page, reported by the URL Inspection API">Last Crawled</span></th>
          <th class="has-tip"><span class="tip" data-tip="When this tool last checked this URL's indexing status via the URL Inspection API">Last Checked</span></th>
          <th class="has-tip"><span class="tip" data-tip="When this URL was last submitted to Google's Indexing API for reindexing">Submitted</span></th>
          <th class="has-tip"><span class="tip" data-tip="Pageviews from the analytics tracker in the last 30 days">Traffic</span></th>
        </tr>
      </thead>
      <tbody>
        {urls.length > 0 ? (
          urls.map((r, i) => (
            <tr>
              <td class="dc">{offset + i + 1}</td>
              <td class="uc">
                <a href={r.url} target="_blank" title={r.url}>
                  {new URL(r.url).pathname}
                </a>
              </td>
              <td>
                {r.label ? (
                  <span
                    class="lbl lbl-set"
                    data-label={r.label}
                    onclick={`editLabel('${escapeHtml(r.url)}',this)`}
                  >
                    {r.label}
                  </span>
                ) : (
                  <span
                    class="lbl"
                    data-label=""
                    onclick={`editLabel('${escapeHtml(r.url)}',this)`}
                  >
                    + label
                  </span>
                )}
              </td>
              <td>
                <Badge status={r.index_status} coverage={r.coverage_state} />
              </td>
              <td class="dc">
                {r.content_updated_at ? formatDate(r.content_updated_at) : <span class="never">—</span>}
              </td>
              <td class="dc">
                {r.last_crawl_time ? formatDate(r.last_crawl_time) : <span class="never">never</span>}
              </td>
              <td class="dc">{formatDate(r.last_checked_at)}</td>
              <td class="dc">
                {r.indexing_submitted_at ? formatDate(r.indexing_submitted_at) : <span class="never">—</span>}
              </td>
              <td class="dc">{r.traffic > 0 ? (
                <a href={`/journeys?property=${encodeURIComponent(propertyId)}&path=${encodeURIComponent(new URL(r.url).pathname)}`} class="traffic-link">{r.traffic}</a>
              ) : <span class="never">—</span>}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colspan={9} style="text-align:center;padding:40px;color:var(--text-muted)">
              No URLs match your filters.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
  );
};

const Pagination: FC<{
  totalPages: number;
  page: number;
  q: string;
  status: string;
  labelFilter: string;
  sort: string;
  dir: string;
  propertyParam: string;
}> = ({ totalPages, page, q, status, labelFilter, sort, dir, propertyParam }) => {
  if (totalPages <= 1) return <></>;
  const params = new URLSearchParams();
  if (propertyParam) params.set('property', propertyParam);
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (labelFilter) params.set('label', labelFilter);
  params.set('sort', sort);
  params.set('dir', dir);
  const base = params.toString();

  const links: (string | { type: 'page'; n: number; current: boolean })[] = [];

  if (page > 1) links.push('prev');
  for (let p = 1; p <= totalPages; p++) {
    if (p <= 3 || p > totalPages - 3 || (p >= page - 2 && p <= page + 2)) {
      links.push({ type: 'page', n: p, current: p === page });
    } else if (p === 4 || p === totalPages - 3) {
      links.push('ellipsis');
    }
  }
  if (page < totalPages) links.push('next');

  return (
    <div class="pg">
      {links.map((link) => {
        if (link === 'prev') return <a href={`?${base}&page=${page - 1}`}>← Prev</a>;
        if (link === 'next') return <a href={`?${base}&page=${page + 1}`}>Next →</a>;
        if (link === 'ellipsis')
          return <span style="border:none;color:var(--text-muted)">…</span>;
        if (typeof link === 'object' && link.current)
          return <span class="cur">{link.n}</span>;
        if (typeof link === 'object')
          return <a href={`?${base}&page=${link.n}`}>{link.n}</a>;
        return null;
      })}
    </div>
  );
};

const BulkLabel: FC<{ total: number }> = ({ total }) => {
  if (total <= 0) return <></>;
  return (
    <form class="bulk" onsubmit="bulkLabel(this,event)">
      <label>Bulk Label</label>
      <input type="text" name="bulk_label" placeholder={`Enter label for ${total} filtered pages…`} />
      <button type="submit">Apply to All {total}</button>
      <span class="cnt">{total} pages</span>
    </form>
  );
};

export const DashboardPage: FC<Props> = (props) => {
  const { stats, urls, totalPages, q, status, labelFilter, labels, sort, dir, page, total, offset, properties, currentProperty, hasData } = props;

  return (
    <Layout page="dashboard" properties={properties} currentProperty={currentProperty}>
      <StatsBar stats={stats} propertyParam={currentProperty?.id || ''} />
      {hasData ? (
        <>
          <Filters q={q} status={status} labelFilter={labelFilter} labels={labels} sort={sort} dir={dir} total={total} propertyParam={currentProperty?.id || ''} />
          <UrlTable urls={urls} offset={offset} propertyId={currentProperty?.id || ''} />
          <BulkLabel total={total} />
          <Pagination totalPages={totalPages} page={page} q={q} status={status} labelFilter={labelFilter} sort={sort} dir={dir} propertyParam={currentProperty?.id || ''} />
        </>
      ) : (
        <div class="empty">
          <h2>No data yet</h2>
          <p>Waiting for first cron run…</p>
        </div>
      )}
    </Layout>
  );
};
