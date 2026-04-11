import type { FC } from 'hono/jsx';
import { html, raw } from 'hono/html';
import type { Property } from '../db';
import { formatDate } from '../lib/utils';
import { Layout } from './Layout';

interface PageviewRow {
  page_path: string;
  ts: string;
  max_scroll?: number | null;
}

interface SessionRow {
  id: string;
  visitor_id: string | null;
  landing_page: string | null;
  exit_page: string | null;
  referrer: string | null;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  ref_domain: string | null;
  is_returning: number;
  page_count: number;
  duration_s: number | null;
  started_at: string | null;
  pages?: PageviewRow[];
}

interface TopPage {
  page_path: string;
  views: number;
}

interface HttpEvent {
  url: string;
  status_code: number;
  referrer: string | null;
  country: string | null;
  device: string | null;
  ts: string | null;
}

interface Props {
  sessions: SessionRow[];
  total: number;
  topPages: TopPage[];
  page: number;
  view: string;
  pathFilter: string;
  pathMode: 'includes' | 'started';
  properties: Property[];
  currentProperty: Property | null;
  top404s: { url: string; count: number }[];
  recentEvents: HttpEvent[];
  pastSessions: Record<string, SessionRow[]>;
  workerOrigin: string;
}

function computePageTimes(pages: PageviewRow[]): { path: string; timeOnPage: string; scroll: number | null }[] {
  return pages.map((pv, i) => {
    let top = '—';
    if (i < pages.length - 1) {
      const curr = new Date(pv.ts).getTime();
      const next = new Date(pages[i + 1].ts).getTime();
      const diffS = Math.max(0, Math.round((next - curr) / 1000));
      if (diffS >= 60) {
        top = `${Math.floor(diffS / 60)}m ${diffS % 60}s`;
      } else {
        top = `${diffS}s`;
      }
    }
    return { path: pv.page_path, timeOnPage: top, scroll: pv.max_scroll ?? null };
  });
}

function formatDur(s: number | null): string {
  if (s == null) return '—';
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

const JOURNEYS_JS = `
document.addEventListener('click', function(e) {
  var btn = e.target.closest('.btn-expand');
  if (!btn) return;
  var card = btn.closest('.s-card');
  var detail = card && card.querySelector('.s-past');
  if (detail) {
    var isOpen = detail.style.display !== 'none';
    detail.style.display = isOpen ? 'none' : 'block';
    btn.textContent = isOpen ? '▾' : '▸';
  }
});
`;

export const JourneysPage: FC<Props> = ({
  sessions,
  total,
  topPages,
  page,
  view,
  pathFilter,
  pathMode,
  properties,
  currentProperty,
  top404s,
  recentEvents,
  pastSessions,
  workerOrigin,
}) => {
  const perPage = 50;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const pp = currentProperty ? `&property=${encodeURIComponent(currentProperty.id)}` : '';
  const pf = pathFilter ? `&path=${encodeURIComponent(pathFilter)}` : '';
  const pm = pathFilter && pathMode === 'started' ? '&pathMode=started' : '';
  const filterQs = `${pp}${pf}${pm}`;
  const is404 = view === '404s';
  const total404s = top404s.reduce((sum, e) => sum + e.count, 0);
  const hasAnyData = total > 0 || total404s > 0 || topPages.length > 0;

  return (
    <Layout page="journeys" properties={properties} currentProperty={currentProperty}>
      <div class="view-tabs">
        <a href={`?view=sessions${pp}`} class={`view-tab ${!is404 ? 'active' : ''}`}>
          Sessions <span class="view-tab-count">{total}</span>
        </a>
        <a href={`?view=404s${pp}`} class={`view-tab ${is404 ? 'active' : ''}`}>
          404s <span class="view-tab-count">{total404s}</span>
        </a>
      </div>

      <form method="get" action="/journeys" class="path-filter-form">
        {currentProperty && <input type="hidden" name="property" value={currentProperty.id} />}
        <input type="hidden" name="view" value="sessions" />
        <select name="pathMode" class="path-mode-select">
          <option value="includes" selected={pathMode === 'includes'}>Includes page</option>
          <option value="started" selected={pathMode === 'started'}>Started on</option>
        </select>
        <input type="text" name="path" value={pathFilter} placeholder="/some/page" class="path-filter-input" />
        <button type="submit" class="path-filter-btn">Filter</button>
        {pathFilter && <a href={`?view=sessions${pp}`} class="path-filter-clear">Clear</a>}
      </form>

      {pathFilter && (
        <div class="path-filter-bar">
          <span>Showing sessions that {pathMode === 'started' ? 'started on' : 'visited'}</span>
          <code class="path-filter-path">{pathFilter}</code>
        </div>
      )}

      <div class="journeys-layout">
        <div class="journeys-main">
          {!is404 ? (
            <>
              {sessions.length > 0 ? (
                <div class="s-list">
                  {sessions.map((s) => {
                    const geo = [s.city, s.country].filter(Boolean).join(', ');
                    const pages = s.pages || [];
                    const pageData = computePageTimes(pages);
                    const visitorPast = s.is_returning && s.visitor_id ? (pastSessions[s.visitor_id] || []) : [];

                    // Compute total session time from page timestamp diffs (more accurate than duration_s)
                    let totalSec = 0;
                    if (pages.length >= 2) {
                      const first = new Date(pages[0].ts).getTime();
                      const last = new Date(pages[pages.length - 1].ts).getTime();
                      totalSec = Math.max(0, Math.round((last - first) / 1000));
                    }
                    const sessionDur = totalSec > 0 ? formatDur(totalSec) : formatDur(s.duration_s);

                    return (
                      <div class="s-card">
                        {/* Meta row */}
                        <div class="s-meta">
                          <span class="s-time">{formatDate(s.started_at)}</span>
                          <span class="s-sep">·</span>
                          <span>{s.page_count} pg{s.page_count !== 1 ? 's' : ''}</span>
                          <span class="s-sep">·</span>
                          <span>{sessionDur}</span>
                          {s.ref_domain && <><span class="s-sep">·</span><span>{s.ref_domain}</span></>}
                          {s.device && <><span class="s-sep">·</span><span>{s.device}</span></>}
                          {geo && <><span class="s-sep">·</span><span>{geo}</span></>}
                          {s.is_returning ? <span class="badge pass" style="margin-left:auto">returning</span> : null}
                        </div>

                        {/* Horizontal page flow */}
                        {pageData.length > 0 && (
                          <div class="s-flow">
                            {pageData.map((pg, i) => (
                              <>
                                <div class="s-chip">
                                  <div class="s-chip-path">{pg.path}</div>
                                  <div class="s-chip-stats">
                                    <span>{pg.timeOnPage}</span>
                                    {pg.scroll != null && (
                                      <span class="s-chip-scroll">
                                        <span class="s-scroll-bar"><span class="s-scroll-fill" style={`width:${Math.min(pg.scroll, 100)}%`}></span></span>
                                        {pg.scroll}%
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {i < pageData.length - 1 && <span class="s-arrow">→</span>}
                              </>
                            ))}
                          </div>
                        )}

                        {/* Past sessions: collapsed summary */}
                        {visitorPast.length > 0 && (
                          <>
                            <div class="s-past-toggle">
                              <span class="btn-expand" style="cursor:pointer;color:var(--text-muted);font-size:10px;user-select:none">▸</span>
                              <span class="s-past-label">
                                {visitorPast.length} past session{visitorPast.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <div class="s-past" style="display:none">
                              {visitorPast.map((ps) => {
                                const pPages = ps.pages || [];
                                return (
                                  <div class="s-past-row">
                                    <div class="s-past-meta">
                                      <span>{formatDate(ps.started_at)}</span>
                                      <span class="s-sep">·</span>
                                      <span>{ps.page_count} pg{ps.page_count !== 1 ? 's' : ''}</span>
                                      <span class="s-sep">·</span>
                                      <span>{formatDur(ps.duration_s)}</span>
                                      {ps.ref_domain && <><span class="s-sep">·</span><span>{ps.ref_domain}</span></>}
                                    </div>
                                    {pPages.length > 0 && (
                                      <div class="s-past-trail">
                                        {pPages.map((pv, i) => (
                                          <span>
                                            {pv.page_path}
                                            {i < pPages.length - 1 && <span class="s-arrow-sm">→</span>}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div class="empty-journeys">
                  {!hasAnyData ? (
                    <>
                      <h3>Tracker not installed</h3>
                      <p>Add the tracking script to your site to start collecting session data:</p>
                      <pre><code>{`<script src="${workerOrigin}/tracker.js" defer></script>`}</code></pre>
                      <p>Paste this before <code>&lt;/head&gt;</code> or <code>&lt;/body&gt;</code> on every page you want to track. Sessions, pageviews, scroll depth, and 404s will appear here automatically.</p>
                    </>
                  ) : (
                    <>
                      <h3>No sessions found</h3>
                      <p>The tracker is working but there are no sessions matching your current filters.</p>
                    </>
                  )}
                </div>
              )}

              {totalPages > 1 && (
                <div class="pg">
                  {page > 1 && <a href={`?page=${page - 1}${filterQs}`}>&larr; Prev</a>}
                  {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((p) =>
                    p === page ? (
                      <span class="cur">{p}</span>
                    ) : (
                      <a href={`?page=${p}${filterQs}`}>{p}</a>
                    )
                  )}
                  {page < totalPages && <a href={`?page=${page + 1}${filterQs}`}>Next &rarr;</a>}
                </div>
              )}
            </>
          ) : (
            <>
              {recentEvents.length > 0 ? (
                <div class="tw">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>URL</th>
                        <th>Referrer</th>
                        <th>Country</th>
                        <th>Device</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentEvents.map((e) => (
                        <tr>
                          <td class="dc">{formatDate(e.ts)}</td>
                          <td class="uc" style="font-family:'SF Mono','JetBrains Mono',monospace;font-size:11px">{e.url}</td>
                          <td class="dc">{e.referrer || '—'}</td>
                          <td class="dc">{e.country || '—'}</td>
                          <td class="dc">{e.device || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div class="empty-journeys">
                  {!hasAnyData ? (
                    <>
                      <h3>Tracker not installed</h3>
                      <p>Add the tracking script to your site to start detecting 404 errors:</p>
                      <pre><code>{`<script src="${workerOrigin}/tracker.js" defer></script>`}</code></pre>
                      <p>For 404 detection, also add this meta tag to your 404 page template:</p>
                      <pre><code>{`<meta name="page-status" content="404">`}</code></pre>
                    </>
                  ) : (
                    <>
                      <h3>No 404s detected</h3>
                      <p>No 404 errors have been recorded in the last 30 days.</p>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div class="journeys-sidebar">
          {!is404 && topPages.length > 0 && (
            <div class="sidebar-section">
              <h3 class="sidebar-heading">Top Pages</h3>
              <div class="top-pages-list">
                {topPages.map((p, i) => (
                  <div class="top-page-item">
                    <span class="top-page-rank">{i + 1}</span>
                    <span class="top-page-path">{p.page_path}</span>
                    <span class="top-page-views">{p.views}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {is404 && top404s.length > 0 && (
            <div class="sidebar-section">
              <h3 class="sidebar-heading">Top 404s</h3>
              <div class="top-pages-list">
                {top404s.map((e, i) => (
                  <div class="top-page-item">
                    <span class="top-page-rank">{i + 1}</span>
                    <span class="top-page-path">{e.url}</span>
                    <span class="top-page-views" style="color:var(--red)">{e.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {html`<script>${raw(JOURNEYS_JS)}</script>`}
    </Layout>
  );
};
