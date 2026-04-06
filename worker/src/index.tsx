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

  const [journeyData, topPages, top404s, recentEvents] = await Promise.all([
    getJourneys(db, currentProperty.id, page, 50, pathFilter || undefined),
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
      properties={properties}
      currentProperty={currentProperty}
      top404s={top404s}
      recentEvents={recentEvents.events}
      pastSessions={pastSessions}
      workerOrigin={url.origin}
    />
  );
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

export default {
  fetch: app.fetch,

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const minute = new Date(event.scheduledTime).getUTCMinutes();

    // :00/:30 = sitemap sync + content scraping
    if (minute === 0 || minute === 30) {
      ctx.waitUntil(
        Promise.all([
          handleSync(env),
          minute === 0 ? cleanupOldAnalytics(env.DB) : Promise.resolve(),
        ])
      );
      return;
    }

    // All other minutes = inspect one property (least recently checked)
    const db = env.DB;
    const properties = await getProperties(db);
    if (properties.length === 0) return;

    const candidates = await db
      .prepare(
        `SELECT p.id,
                MAX(cr.started_at) AS last_run,
                (SELECT COUNT(*) FROM check_runs cr2
                 WHERE cr2.property_id = p.id
                 AND cr2.urls_checked = 0 AND cr2.urls_error > 0
                 AND cr2.started_at > datetime('now', '-2 hours')
                ) AS recent_error_streak
         FROM properties p
         LEFT JOIN check_runs cr ON p.id = cr.property_id
         GROUP BY p.id
         ORDER BY last_run ASC NULLS FIRST`
      )
      .all<{ id: string; last_run: string | null; recent_error_streak: number }>();

    let propertyId: string | null = null;

    for (const c of candidates.results) {
      if (c.recent_error_streak === 0) {
        propertyId = c.id;
        break;
      }

      const backoffMin = Math.min(60, 7 * Math.pow(2, c.recent_error_streak - 1));
      const lastRunAge = c.last_run
        ? (Date.now() - new Date(c.last_run).getTime()) / 60000
        : Infinity;

      if (lastRunAge >= backoffMin) {
        propertyId = c.id;
        break;
      }
    }

    if (!propertyId) return;

    ctx.waitUntil(handleInspectProperty(env, propertyId));
  },
};
