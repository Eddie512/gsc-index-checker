/**
 * GSC Index Checker — Cloudflare Worker Entry Point (Hono)
 *
 * Handles:
 * - Cron trigger: sync sitemap URLs, check batch via GSC API, submit to Indexing API
 * - HTTP requests: serve the dashboard, label API endpoints
 *
 * Supports multiple Search Console properties.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { getAllUrlsFromSitemap } from './sitemap';
import { inspectUrl } from './gsc-api';
import { submitUrl } from './indexing-api';
import { scrapeContentDates, CONTENT_SCRAPE_BATCH } from './content-api';
import {
  getProperties,
  getProperty,
  createProperty,
  updateProperty,
  deleteProperty,
  upsertUrls,
  reconcileUrls,
  updateInspection,
  getUrlsToCheck,
  recordRun,
  recordActivity,
  getStats,
  getFilteredStats,
  getUrls,
  getRuns,
  getDistinctLabels,
  updateLabel,
  bulkUpdateLabel,
  syncContentUpdatedDates,
  getIndexingSubmittedToday,
  getUrlsToSubmit,
  recordIndexingSubmission,
  deleteRemovedUrl,
  recordPageview,
  updateSessionDuration,
  getJourneys,
  getTopPages,
  recordHttpEvent,
  getHttpEvents,
  getTop404s,
  getRecentlySubmitted,
  getPastSessionsByVisitors,
  getUrlsForContentScrape,
  markUrlsScraped,
  cleanupOldAnalytics,
  getPathTraffic,
  rebuildPageviewRollup,
} from './db';
import type { Property } from './db';
import type { Env } from './lib/types';
import { sleep, csvSafe } from './lib/utils';
import {
  BATCH_SIZE,
  API_DELAY_MS,
  INDEXING_DAILY_QUOTA,
  INDEXING_BATCH_PER_RUN,
  BOT_PATTERN,
} from './lib/constants';

import { DashboardPage } from './components/DashboardPage';
import { RunsPage } from './components/RunsPage';
import { JourneysPage } from './components/JourneysPage';
import { EventsPage } from './components/EventsPage';
import { SubmittedPage } from './components/SubmittedPage';
import { PropertiesPage } from './components/PropertiesPage';

// ---------------------------------------------------------------------------
// Cloudflare request type (for cf geo properties)
// ---------------------------------------------------------------------------

interface CfProperties {
  country?: string;
  city?: string;
}

function getCfProperties(req: Request): CfProperties {
  const cf = (req as Request & { cf?: CfProperties }).cf;
  return { country: cf?.country || undefined, city: cf?.city || undefined };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// ---- CORS for tracker endpoints ----
app.use('/t', cors({ origin: '*', allowMethods: ['POST'] }));
app.use('/e', cors({ origin: '*', allowMethods: ['POST'] }));
app.use('/api/traffic', cors({ origin: '*', allowMethods: ['GET'] }));

// ---- Crawler guard for dashboard pages ----
// The dashboards are server-rendered from expensive D1 aggregations and the
// journeys page links every tracked path, so a crawler walking the link graph
// fired thousands of heavy scans a day. Tracker beacons, the public traffic
// API, and robots.txt stay open; everything else turns crawlers away.
const BOT_EXEMPT_PATHS = new Set(['/t', '/e', '/tracker.js', '/api/traffic', '/robots.txt']);
app.use('*', async (c, next) => {
  if (!BOT_EXEMPT_PATHS.has(c.req.path)) {
    const ua = (c.req.header('User-Agent') || '').toLowerCase();
    if (BOT_PATTERN.test(ua)) return c.text('crawling disallowed', 403);
  }
  await next();
});

app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'));

// ---- Tracker script ----
app.get('/tracker.js', (c) => {
  const workerOrigin = new URL(c.req.url).origin;
  const script = `(function(){if(navigator.webdriver)return;var s=sessionStorage,l=localStorage,k='_tid',kt='_tit',v='_vid',lp='_tlp',e='${workerOrigin}/t',ee='${workerOrigin}/e';
var now=Date.now(),sid=l.getItem(k),st=parseInt(l.getItem(kt)||'0'),vid=l.getItem(v),p=location.pathname;
var n=!sid||(now-st>1800000);
if(n){sid=Math.random().toString(36).slice(2,14)}
l.setItem(k,sid);l.setItem(kt,now.toString());
if(!vid){vid=Math.random().toString(36).slice(2,14);l.setItem(v,vid)}
var m=document.querySelector('meta[name="page-status"]');if(m){fetch(ee,{method:'POST',body:JSON.stringify({u:p,c:parseInt(m.content)||404,r:document.referrer}),keepalive:true}).catch(function(){})}
if(l.getItem(lp)===p)return;l.setItem(lp,p);
var t0=Date.now(),ms=0,o={s:sid,v:vid,p:p,r:document.referrer,n:n?1:0};
if(n){o.w=screen.width;o.lg=navigator.language;var u=new URLSearchParams(location.search);if(u.get('utm_source'))o.us=u.get('utm_source');if(u.get('utm_medium'))o.um=u.get('utm_medium');if(u.get('utm_campaign'))o.uc=u.get('utm_campaign')}
fetch(e,{method:'POST',body:JSON.stringify(o),keepalive:true}).catch(function(){});
window.addEventListener('scroll',function(){var h=document.documentElement,pct=Math.round((window.scrollY+window.innerHeight)/h.scrollHeight*100);if(pct>ms)ms=pct},{passive:true});
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'){l.setItem(kt,Date.now().toString());navigator.sendBeacon(e,JSON.stringify({s:sid,p:p,d:Math.round((Date.now()-t0)/1000),ms:ms}))}})
})()`;

  return c.body(script, 200, {
    'Content-Type': 'application/javascript',
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  });
});

// ---- Tracking endpoint ----
app.post('/t', async (c) => {
  const ua = (c.req.header('User-Agent') || '').toLowerCase();
  if (BOT_PATTERN.test(ua)) return c.text('ok');

  try {
    const body = await c.req.json<{
      s: string; v?: string; p?: string; r?: string; n?: number; d?: number;
      w?: number; us?: string; um?: string; uc?: string; lg?: string; ms?: number;
    }>();

    const db = c.env.DB;

    // Duration + scroll update (sendBeacon on unload)
    if (body.d !== undefined) {
      await updateSessionDuration(db, body.s, body.d, body.ms ?? null, body.p ?? null);
      return c.text('ok');
    }

    // Resolve property from Referer domain
    const referer = c.req.header('Referer') || body.r || '';
    let propId = '';
    let refDomain: string | null = null;
    try {
      const refUrl = new URL(referer);
      const refHost = refUrl.hostname;
      const properties = await getProperties(db);
      const match = properties.find((p) => refHost.includes(p.domain.replace('www.', '')));
      if (match) propId = match.id;

      if (body.r) {
        try {
          const extHost = new URL(body.r).hostname.replace('www.', '');
          if (!properties.some((p) => extHost.includes(p.domain.replace('www.', '')))) {
            refDomain = extHost;
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore parse errors */ }

    if (!propId || !body.p) return c.text('ok');

    const cf = getCfProperties(c.req.raw);
    const country = cf.country || null;
    const city = cf.city || null;

    const uaFull = c.req.header('User-Agent') || '';
    let device: string | null = null;
    if (/Mobi|Android.*Mobile|iPhone|iPod/i.test(uaFull)) device = 'mobile';
    else if (/iPad|Android(?!.*Mobile)|Tablet/i.test(uaFull)) device = 'tablet';
    else if (uaFull) device = 'desktop';

    let browser: string | null = null;
    if (/Edg\//i.test(uaFull)) browser = 'Edge';
    else if (/OPR\//i.test(uaFull)) browser = 'Opera';
    else if (/Chrome\//i.test(uaFull)) browser = 'Chrome';
    else if (/Safari\//i.test(uaFull) && !/Chrome/i.test(uaFull)) browser = 'Safari';
    else if (/Firefox\//i.test(uaFull)) browser = 'Firefox';

    let isReturning = false;
    if (body.n === 1 && body.v) {
      const prev = await db
        .prepare('SELECT 1 FROM sessions WHERE visitor_id = ? LIMIT 1')
        .bind(body.v)
        .first();
      isReturning = !!prev;
    }

    await recordPageview(
      db, propId, body.s, body.v || null,
      body.p, body.r || null, body.n === 1,
      country, city, device, body.w || null,
      body.us || null, body.um || null, body.uc || null,
      refDomain, browser, body.lg || null, isReturning
    );

    return c.text('ok');
  } catch {
    return c.text('err', 400);
  }
});

// ---- HTTP Events endpoint (404s, redirects) ----
app.post('/e', async (c) => {
  const ua = (c.req.header('User-Agent') || '').toLowerCase();
  if (BOT_PATTERN.test(ua)) return c.text('ok');

  try {
    const body = await c.req.json<{ u: string; c: number; r?: string; t?: string }>();
    const db = c.env.DB;

    const referer = c.req.header('Referer') || body.r || '';
    let propId = '';
    try {
      const refHost = new URL(referer).hostname;
      const properties = await getProperties(db);
      const match = properties.find((p) => refHost.includes(p.domain.replace('www.', '')));
      if (match) propId = match.id;
    } catch { /* ignore */ }

    if (!propId || !body.u) return c.text('ok');

    const cf = getCfProperties(c.req.raw);
    const uaFull = c.req.header('User-Agent') || '';
    let device: string | null = null;
    if (/Mobi|Android.*Mobile|iPhone|iPod/i.test(uaFull)) device = 'mobile';
    else if (/iPad|Android(?!.*Mobile)|Tablet/i.test(uaFull)) device = 'tablet';
    else if (uaFull) device = 'desktop';

    await recordHttpEvent(
      db, propId, body.u, body.c,
      body.t || null, body.r || null,
      cf.country || null, cf.city || null, device
    );

    return c.text('ok');
  } catch {
    return c.text('err', 400);
  }
});

// ---------------------------------------------------------------------------
// Dashboard routes — resolve current property via middleware-style helper
// ---------------------------------------------------------------------------

async function resolveProperty(db: D1Database, url: URL): Promise<{ properties: Property[]; currentProperty: Property }> {
  const properties = await getProperties(db);
  const propertyId = url.searchParams.get('property') || properties[0]?.id || '';
  const currentProperty = properties.find((p) => p.id === propertyId) || properties[0];
  if (!currentProperty) throw new Error('No properties configured');
  return { properties, currentProperty };
}

// ---- API: Traffic per path (public, CORS-enabled) ----
app.get('/api/traffic', async (c) => {
  const propertyId = c.req.query('property');
  if (!propertyId) return c.json({ error: 'Missing property' }, 400);

  // Analytics retention is 30 days; cap days so the prior-window comparison
  // doesn't quietly slide into an empty range.
  const daysRaw = parseInt(c.req.query('days') || '7', 10);
  const days = Math.min(15, Math.max(1, Number.isFinite(daysRaw) ? daysRaw : 7));

  const limitRaw = parseInt(c.req.query('limit') || '50', 10);
  const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50));

  // getPathTraffic is expensive and this endpoint is hit on every render of the
  // public trending widget, so cache the result at the edge keyed by the
  // normalized params. Note caches.default is per-datacenter, not global — every
  // colo warms its own copy — so the TTL is generous (1h; trending over a
  // multi-day window barely moves in an hour). CORS is applied by middleware on
  // both hit and miss, so the stored copy doesn't need the header.
  const cache = caches.default;
  const cacheKey = new Request(
    `https://traffic-cache.internal/?property=${encodeURIComponent(propertyId)}&days=${days}&limit=${limit}`
  );
  const cached = await cache.match(cacheKey);
  if (cached) return new Response(cached.body, cached);

  const property = await getProperty(c.env.DB, propertyId);
  if (!property) return c.json({ error: 'Property not found' }, 404);

  const traffic = await getPathTraffic(c.env.DB, propertyId, days, limit);
  const res = c.json(traffic);
  res.headers.set('Cache-Control', 'public, max-age=3600');
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
});

// ---- API: Set label for a single URL ----
app.post('/api/label', async (c) => {
  const url = new URL(c.req.url);
  const { currentProperty } = await resolveProperty(c.env.DB, url);
  const body = await c.req.json<{ url: string; label: string | null }>();
  await updateLabel(c.env.DB, body.url, currentProperty.id, body.label);
  return c.json({ ok: true });
});

// ---- API: Bulk label ----
app.post('/api/bulk-label', async (c) => {
  const url = new URL(c.req.url);
  const { currentProperty } = await resolveProperty(c.env.DB, url);
  const body = await c.req.json<{
    label: string | null; q?: string; status?: string; labelFilter?: string;
  }>();
  const updated = await bulkUpdateLabel(c.env.DB, currentProperty.id, body.label, {
    q: body.q,
    status: body.status,
    labelFilter: body.labelFilter,
  });
  return c.json({ ok: true, updated });
});

// ---- API: Create property ----
app.post('/api/properties', async (c) => {
  const body = await c.req.json<{
    id: string; name: string; site_url: string; domain: string; sitemap_url: string | null;
  }>();
  if (!body.id || !body.name || !body.site_url || !body.domain) {
    return c.json({ error: 'Missing required fields: id, name, site_url, domain' }, 400);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(body.id)) {
    return c.json({ error: 'ID must be lowercase alphanumeric with hyphens (e.g. my-site)' }, 400);
  }
  const existing = await getProperty(c.env.DB, body.id);
  if (existing) {
    return c.json({ error: `Property "${body.id}" already exists` }, 409);
  }
  await createProperty(c.env.DB, body);
  c.executionCtx.waitUntil(
    handleSync(c.env).then(() => handleInspect(c.env))
  );
  return c.json({ ok: true, id: body.id });
});

// ---- API: Update property ----
app.put('/api/properties/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    name: string; site_url: string; domain: string; sitemap_url: string | null;
  }>();
  if (!body.name || !body.site_url || !body.domain) {
    return c.json({ error: 'Missing required fields: name, site_url, domain' }, 400);
  }
  await updateProperty(c.env.DB, id, body);
  return c.json({ ok: true });
});

// ---- API: Delete property ----
app.delete('/api/properties/:id', async (c) => {
  const id = c.req.param('id');
  await deleteProperty(c.env.DB, id);
  return c.json({ ok: true });
});

// ---- Trigger cron manually ----
app.get('/trigger', async (c) => {
  c.executionCtx.waitUntil(
    handleSync(c.env).then(() => handleInspect(c.env))
  );
  return c.text('Check triggered. View results on the dashboard.');
});

// ---- Trigger only Indexing API submissions (for testing) ----
app.get('/submit', async (c) => {
  const url = new URL(c.req.url);
  const { currentProperty } = await resolveProperty(c.env.DB, url);
  const submittedToday = await getIndexingSubmittedToday(c.env.DB);
  const remaining = Math.max(0, INDEXING_DAILY_QUOTA - submittedToday);
  if (remaining <= 0) {
    return c.json({ message: 'Daily quota reached', submittedToday });
  }
  const batchLimit = Math.min(remaining, 5);
  const urlsToSubmit = await getUrlsToSubmit(c.env.DB, currentProperty.id, batchLimit);
  const results: { url: string; type: string; success: boolean; error?: string }[] = [];
  for (const submission of urlsToSubmit) {
    const result = await submitUrl(submission.url, submission.type, c.env.GSC_CLIENT_EMAIL, c.env.GSC_PRIVATE_KEY);
    if (result.success) {
      if (submission.type === 'URL_DELETED') {
        await deleteRemovedUrl(c.env.DB, submission.url, currentProperty.id);
      } else {
        await recordIndexingSubmission(c.env.DB, submission.url);
      }
    }
    results.push({ url: submission.url, type: submission.type, ...result });
    await sleep(500);
  }
  return c.json({ property: currentProperty.id, submittedToday, remaining, results });
});

// ---- CSV export ----
app.get('/export', async (c) => {
  const url = new URL(c.req.url);
  const { currentProperty } = await resolveProperty(c.env.DB, url);
  const { urls } = await getUrls(c.env.DB, currentProperty.id, {
    sort: 'url',
    dir: 'asc',
    perPage: 999999,
  });

  const csvHeader =
    'URL,Index Status,Coverage State,Last Crawl Time,Last Checked At,Label,Content Updated,Submitted\n';
  const csvRows = urls
    .map(
      (r) =>
        `"${csvSafe(r.url)}","${csvSafe(r.index_status)}","${csvSafe(r.coverage_state)}","${csvSafe(r.last_crawl_time)}","${csvSafe(r.last_checked_at)}","${csvSafe(r.label)}","${csvSafe(r.content_updated_at)}","${csvSafe(r.indexing_submitted_at)}"`
    )
    .join('\n');

  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return c.body(csvHeader + csvRows, 200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment;filename=gsc_${currentProperty.id}_${timestamp}.csv`,
  });
});

// ---- Dashboard ----
app.get('/', async (c) => {
  const url = new URL(c.req.url);
  const db = c.env.DB;
  const { properties, currentProperty } = await resolveProperty(db, url);

  const q = url.searchParams.get('q') || '';
  const status = url.searchParams.get('status') || '';
  const labelFilter = url.searchParams.get('label') || '';
  const sort = url.searchParams.get('sort') || 'last_checked_at';
  const dir = url.searchParams.get('dir') || 'desc';
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const perPage = 100;
  const offset = (page - 1) * perPage;

  const hasScope = !!(q || status || labelFilter);
  const [globalStats, filteredStats, { urls, total }, labels] = await Promise.all([
    getStats(db, currentProperty.id),
    hasScope
      ? getFilteredStats(db, currentProperty.id, { q, status, labelFilter })
      : Promise.resolve(null),
    getUrls(db, currentProperty.id, { q, status, labelFilter, sort, dir, page, perPage }),
    getDistinctLabels(db, currentProperty.id),
  ]);
  const statsData = filteredStats || globalStats;

  const totalPages = Math.ceil(total / perPage);

  return c.html(
    <DashboardPage
      stats={statsData}
      urls={urls}
      totalPages={totalPages}
      q={q}
      status={status}
      labelFilter={labelFilter}
      labels={labels}
      sort={sort}
      dir={dir}
      page={page}
      total={total}
      offset={offset}
      properties={properties}
      currentProperty={currentProperty}
      hasData={globalStats.total > 0}
    />
  );
});

// ---- Runs history page ----
app.get('/runs', async (c) => {
  const url = new URL(c.req.url);
  const db = c.env.DB;
  const { properties, currentProperty } = await resolveProperty(db, url);
  const runs = await getRuns(db, currentProperty.id);
  return c.html(<RunsPage runs={runs} properties={properties} currentProperty={currentProperty} />);
});

// ---- Journeys page ----
app.get('/journeys', async (c) => {
  const url = new URL(c.req.url);
  const db = c.env.DB;
  const { properties, currentProperty } = await resolveProperty(db, url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const view = url.searchParams.get('view') || 'sessions';
  const pathFilter = url.searchParams.get('path') || '';
  const pathMode: 'includes' | 'started' = url.searchParams.get('pathMode') === 'started' ? 'started' : 'includes';
  const countryFilter = url.searchParams.get('country') || '';
  const deviceFilter = url.searchParams.get('device') || '';
  const returningFilter = url.searchParams.get('returning') as 'new' | 'returning' | '' || '';

  const journeyFilters = {
    pathFilter: pathFilter || undefined,
    pathMode,
    country: countryFilter || undefined,
    device: deviceFilter || undefined,
    returning: (returningFilter || undefined) as 'new' | 'returning' | undefined,
  };

  const [journeyData, topPages, top404s, recentEvents] = await Promise.all([
    getJourneys(db, currentProperty.id, page, 50, journeyFilters),
    getTopPages(db, currentProperty.id),
    getTop404s(db, currentProperty.id),
    getHttpEvents(db, currentProperty.id, 404),
  ]);

  const returningVisitorIds = journeyData.sessions
    .filter((s) => s.is_returning === 1 && s.visitor_id)
    .map((s) => s.visitor_id!);
  const currentSessionIds = journeyData.sessions.map((s) => s.id);
  const uniqueVisitorIds = [...new Set(returningVisitorIds)];
  const pastSessionsMap = uniqueVisitorIds.length > 0
    ? await getPastSessionsByVisitors(db, currentProperty.id, uniqueVisitorIds, currentSessionIds)
    : new Map();

  const pastSessions: Record<string, any[]> = {};
  for (const [vid, sessions] of pastSessionsMap) {
    pastSessions[vid] = sessions;
  }

  return c.html(
    <JourneysPage
      sessions={journeyData.sessions}
      total={journeyData.total}
      topPages={topPages}
      page={page}
      view={view}
      pathFilter={pathFilter}
      pathMode={pathMode}
      countryFilter={countryFilter}
      deviceFilter={deviceFilter}
      returningFilter={returningFilter}
      properties={properties}
      currentProperty={currentProperty}
      top404s={top404s}
      recentEvents={recentEvents.events}
      pastSessions={pastSessions}
      workerOrigin={url.origin}
    />
  );
});

// ---- Journeys CSV export ----
app.get('/journeys/export', async (c) => {
  const url = new URL(c.req.url);
  const db = c.env.DB;
  const { currentProperty } = await resolveProperty(db, url);
  const pathFilter = url.searchParams.get('path') || '';
  const pathMode: 'includes' | 'started' = url.searchParams.get('pathMode') === 'started' ? 'started' : 'includes';
  const countryFilter = url.searchParams.get('country') || '';
  const deviceFilter = url.searchParams.get('device') || '';
  const returningFilter = url.searchParams.get('returning') as 'new' | 'returning' | '' || '';

  const data = await getJourneys(db, currentProperty.id, 1, 10000, {
    pathFilter: pathFilter || undefined,
    pathMode,
    country: countryFilter || undefined,
    device: deviceFilter || undefined,
    returning: (returningFilter || undefined) as 'new' | 'returning' | undefined,
  });

  const header = 'Date,Duration,Pages,Device,Region,Type,Journey\n';
  const rows = data.sessions.map((s) => {
    const pages = s.pages || [];
    let durSec = 0;
    if (pages.length >= 2) {
      const first = new Date(pages[0].ts).getTime();
      const last = new Date(pages[pages.length - 1].ts).getTime();
      durSec = Math.max(0, Math.round((last - first) / 1000));
    }
    if (!durSec && s.duration_s) durSec = s.duration_s;
    const durStr = durSec >= 60 ? `${Math.floor(durSec / 60)}m ${durSec % 60}s` : `${durSec}s`;
    const geo = [s.city, s.country].filter(Boolean).join(', ');
    const type = s.is_returning ? 'returning' : 'new';
    const journey = pages.map((p) => p.page_path).join(' > ');
    return `"${csvSafe(s.started_at)}","${durStr}",${s.page_count},"${csvSafe(s.device)}","${csvSafe(geo)}","${type}","${csvSafe(journey)}"`;
  }).join('\n');

  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return c.body(header + rows, 200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment;filename=sessions_${currentProperty.id}_${timestamp}.csv`,
  });
});

// ---- HTTP Events page ----
app.get('/events', async (c) => {
  const url = new URL(c.req.url);
  const db = c.env.DB;
  const { properties, currentProperty } = await resolveProperty(db, url);
  const statusFilter = url.searchParams.get('status') ? parseInt(url.searchParams.get('status')!, 10) : null;
  const eventData = await getHttpEvents(db, currentProperty.id, statusFilter);
  return c.html(
    <EventsPage
      events={eventData.events}
      counts={eventData.counts}
      properties={properties}
      currentProperty={currentProperty}
      statusFilter={statusFilter}
    />
  );
});

// ---- Recently Submitted page ----
app.get('/submitted', async (c) => {
  const url = new URL(c.req.url);
  const db = c.env.DB;
  const { properties, currentProperty } = await resolveProperty(db, url);
  const urls = await getRecentlySubmitted(db, currentProperty.id);
  return c.html(<SubmittedPage urls={urls} properties={properties} currentProperty={currentProperty} />);
});

// ---- Properties management page ----
app.get('/properties', async (c) => {
  const url = new URL(c.req.url);
  const db = c.env.DB;
  const properties = await getProperties(db);
  const currentProperty = properties[0] || null;
  const editId = url.searchParams.get('edit');
  const editProp = editId ? await getProperty(db, editId) : null;
  return c.html(
    <PropertiesPage properties={properties} currentProperty={currentProperty} editProperty={editProp} />
  );
});

// ---------------------------------------------------------------------------
// Cron handlers
// ---------------------------------------------------------------------------

async function handleSync(env: Env): Promise<void> {
  const db = env.DB;
  const properties = await getProperties(db);

  for (const prop of properties) {
    if (prop.sitemap_url) {
      const syncStart = new Date().toISOString();
      try {
        const sitemapUrls = await getAllUrlsFromSitemap(prop.sitemap_url);
        if (sitemapUrls.length === 0) {
          await recordActivity(db, prop.id, 'sync', syncStart, new Date().toISOString(), { urls_found: 0, error: 'empty sitemap' });
          continue;
        }
        await upsertUrls(db, prop.id, sitemapUrls);

        const reconciled = await reconcileUrls(db, prop.id, sitemapUrls);
        await recordActivity(db, prop.id, 'sync', syncStart, new Date().toISOString(), {
          urls_found: sitemapUrls.length,
          marked_for_deletion: reconciled.markedForDeletion,
          deleted: reconciled.deleted,
          restored: reconciled.restored,
        });
      } catch (error) {
        await recordActivity(db, prop.id, 'sync', syncStart, new Date().toISOString(), { error: String(error) }).catch(() => {});
      }
    }

    // Content date detection: scrape pages for meta tags / Last-Modified header
    const scrapeStart = new Date().toISOString();
    try {
      const urlsToScrape = await getUrlsForContentScrape(db, prop.id, CONTENT_SCRAPE_BATCH);
      if (urlsToScrape.length > 0) {
        const { dateMap, stats } = await scrapeContentDates(urlsToScrape);
        await markUrlsScraped(db, urlsToScrape);
        const synced = dateMap.size > 0 ? await syncContentUpdatedDates(db, dateMap) : 0;
        const details: Record<string, string | number> = {
          pages_scraped: stats.scraped,
          dates_found: stats.datesFound,
          dates_synced: synced,
          skipped: stats.skipped,
          errors: stats.errors,
        };
        await recordActivity(db, prop.id, 'scrape', scrapeStart, new Date().toISOString(), details);
      }
    } catch (error) {
      await recordActivity(db, prop.id, 'scrape', scrapeStart, new Date().toISOString(), { error: String(error) }).catch(() => {});
    }
  }
}

async function handleInspect(env: Env): Promise<void> {
  const db = env.DB;
  const properties = await getProperties(db);

  for (const prop of properties) {
    const startedAt = new Date().toISOString();
    const urlsToCheck = await getUrlsToCheck(db, prop.id, BATCH_SIZE);
    if (urlsToCheck.length === 0) continue;

    const stats = { checked: 0, indexed: 0, notIndexed: 0, errors: 0 };
    let firstError: string | null = null;

    let quotaExhausted = false;
    for (const url of urlsToCheck) {
      try {
        const result = await inspectUrl(url, prop.site_url, env.GSC_CLIENT_EMAIL, env.GSC_PRIVATE_KEY);
        await updateInspection(db, url, result);

        if (result.indexStatus === 'PASS') {
          stats.indexed++;
        } else {
          stats.notIndexed++;
        }
        stats.checked++;
        await sleep(API_DELAY_MS);
      } catch (error) {
        stats.errors++;
        const msg = error instanceof Error ? error.message : String(error);
        if (!firstError) firstError = msg.slice(0, 300);
        // Stop early on quota/rate-limit errors (429 or 403 with quota)
        if (msg.includes('429') || (msg.includes('403') && msg.includes('quota'))) {
          quotaExhausted = true;
          break;
        }
        await sleep(2000);
      }
    }

    const runDetails = firstError ? { error: firstError } : null;
    const finishedAt = new Date().toISOString();
    await recordRun(db, prop.id, startedAt, finishedAt, stats.checked, stats.indexed, stats.notIndexed, stats.errors, runDetails);

    if (quotaExhausted) break; // skip remaining properties
  }

  // Indexing API submissions
  try {
    const submittedToday = await getIndexingSubmittedToday(db);
    const remaining = Math.max(0, INDEXING_DAILY_QUOTA - submittedToday);

    if (remaining > 0) {
      const batchLimit = Math.min(remaining, INDEXING_BATCH_PER_RUN);
      const perProperty = Math.max(1, Math.floor(batchLimit / properties.length));

      for (const prop of properties) {
        const urlsToSubmit = await getUrlsToSubmit(db, prop.id, perProperty);
        if (urlsToSubmit.length === 0) continue;

        for (const submission of urlsToSubmit) {
          const result = await submitUrl(submission.url, submission.type, env.GSC_CLIENT_EMAIL, env.GSC_PRIVATE_KEY);
          if (result.success) {
            if (submission.type === 'URL_DELETED') {
              await deleteRemovedUrl(db, submission.url, prop.id);
            } else {
              await recordIndexingSubmission(db, submission.url);
            }
          }
          await sleep(500);
        }
      }
    }
  } catch {
    // Indexing API step failed — non-critical, recorded in next run
  }
}

async function handleInspectProperty(env: Env, propertyId: string): Promise<void> {
  const db = env.DB;
  const prop = await getProperty(db, propertyId);
  if (!prop) return;

  const startedAt = new Date().toISOString();
  const urlsToCheck = await getUrlsToCheck(db, prop.id, BATCH_SIZE);
  if (urlsToCheck.length === 0) return;

  const stats = { checked: 0, indexed: 0, notIndexed: 0, errors: 0 };
  let firstError: string | null = null;

  for (const url of urlsToCheck) {
    try {
      const result = await inspectUrl(url, prop.site_url, env.GSC_CLIENT_EMAIL, env.GSC_PRIVATE_KEY);
      await updateInspection(db, url, result);

      if (result.indexStatus === 'PASS') stats.indexed++;
      else stats.notIndexed++;
      stats.checked++;
      await sleep(API_DELAY_MS);
    } catch (error) {
      stats.errors++;
      const msg = error instanceof Error ? error.message : String(error);
      if (!firstError) firstError = msg.slice(0, 300);
      if (msg.includes('429') || (msg.includes('403') && msg.includes('quota'))) {
        break;
      }
      await sleep(2000);
    }
  }

  const runDetails = firstError ? { error: firstError } : null;
  const finishedAt = new Date().toISOString();
  await recordRun(db, prop.id, startedAt, finishedAt, stats.checked, stats.indexed, stats.notIndexed, stats.errors, runDetails);

  try {
    const submittedToday = await getIndexingSubmittedToday(db);
    const remaining = Math.max(0, INDEXING_DAILY_QUOTA - submittedToday);
    if (remaining > 0) {
      const batchLimit = Math.min(remaining, INDEXING_BATCH_PER_RUN);
      const urlsToSubmit = await getUrlsToSubmit(db, prop.id, batchLimit);
      for (const submission of urlsToSubmit) {
        const result = await submitUrl(submission.url, submission.type, env.GSC_CLIENT_EMAIL, env.GSC_PRIVATE_KEY);
        if (result.success) {
          if (submission.type === 'URL_DELETED') {
            await deleteRemovedUrl(db, submission.url, prop.id);
          } else {
            await recordIndexingSubmission(db, submission.url);
          }
        }
        await sleep(500);
      }
    }
  } catch {
    // Indexing API step failed — non-critical
  }
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

/**
 * Pick which property to inspect next: the least-recently-inspected one whose
 * error backoff (if any) has elapsed. Pure, so the ordering/backoff logic can be
 * unit-tested without the cron or network.
 *
 * @param lastRunById  property_id → most recent inspect run (ISO); absent = never run
 * @param streakById   property_id → count of all-error inspect runs in the last 2h
 */
export function pickPropertyToInspect(
  propertyIds: string[],
  lastRunById: Map<string, string | null>,
  streakById: Map<string, number>,
  nowMs: number
): string | null {
  const candidates = propertyIds
    .map((id) => ({ id, lastRun: lastRunById.get(id) ?? null, streak: streakById.get(id) ?? 0 }))
    // Least-recently-inspected first; never-inspected (null) sorts first.
    .sort((a, b) => {
      if (a.lastRun === b.lastRun) return 0;
      if (a.lastRun === null) return -1;
      if (b.lastRun === null) return 1;
      return a.lastRun < b.lastRun ? -1 : 1;
    });

  for (const c of candidates) {
    if (c.streak === 0) return c.id;
    const backoffMin = Math.min(60, 7 * Math.pow(2, c.streak - 1));
    const lastRunAge = c.lastRun ? (nowMs - new Date(c.lastRun).getTime()) / 60000 : Infinity;
    if (lastRunAge >= backoffMin) return c.id;
  }
  return null;
}

export default {
  fetch: app.fetch,

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const minute = new Date(event.scheduledTime).getUTCMinutes();

    // :00/:30 = sitemap sync + pageview rollup refresh + (hourly) retention
    if (minute === 0 || minute === 30) {
      ctx.waitUntil(
        Promise.all([
          handleSync(env),
          rebuildPageviewRollup(env.DB),
          minute === 0 ? cleanupOldAnalytics(env.DB) : Promise.resolve(),
        ])
      );
      return;
    }

    // All other minutes = inspect one property (least recently checked)
    const db = env.DB;
    const properties = await getProperties(db);
    if (properties.length === 0) return;

    // Two indexed lookups instead of one full-history scan. The old shape summed
    // a 2-hour CASE across every check_runs row (LEFT JOIN over all history),
    // which grew without bound. Now: (A) the latest inspect run per property, and
    // (B) the recent all-error inspect runs pruned to the last 2 hours — both
    // served by idx_runs_property_type_started. Merged by pickPropertyToInspect.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const [lastRuns, streaks] = await Promise.all([
      db
        .prepare(
          // Correlated subquery rather than GROUP BY: without ANALYZE stats the
          // planner answers the GROUP BY by scanning every inspect run, while
          // this form does one covering-index seek to the latest run per
          // property (properties is a handful of rows).
          `SELECT p.id AS property_id,
                  (SELECT MAX(cr.started_at)
                     FROM check_runs cr
                    WHERE cr.property_id = p.id AND cr.run_type = 'inspect') AS last_run
             FROM properties p`
        )
        .all<{ property_id: string; last_run: string | null }>(),
      db
        .prepare(
          `SELECT property_id, COUNT(*) AS streak
             FROM check_runs
            WHERE run_type = 'inspect'
              AND urls_checked = 0 AND urls_error > 0
              AND started_at > ?
            GROUP BY property_id`
        )
        .bind(twoHoursAgo)
        .all<{ property_id: string; streak: number }>(),
    ]);

    const lastRunById = new Map(lastRuns.results.map((r) => [r.property_id, r.last_run]));
    const streakById = new Map(streaks.results.map((r) => [r.property_id, r.streak]));

    const propertyId = pickPropertyToInspect(
      properties.map((p) => p.id),
      lastRunById,
      streakById,
      Date.now()
    );

    if (!propertyId) return;

    ctx.waitUntil(handleInspectProperty(env, propertyId));
  },
};
