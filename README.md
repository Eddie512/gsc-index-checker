# GSC Index Checker

A tool built to solve one of the most frustrating problems in SEO: knowing when Google actually indexes your pages, and making sure it happens fast.

Tracking indexing status across hundreds or thousands of pages — especially across different templates — is nearly impossible to do manually. Writers and editors forget to request reindexing, and Google Search Console limits you to 10 manual submissions per day. Pages get updated but sit stale in Google's index for days or weeks. Pages get deleted but keep showing up in search results. There's no single view that ties together when content was last updated, when Google last crawled it, and whether it's actually indexed.

This tool fixes that. It runs as a lightweight Cloudflare Worker, monitors all your properties in one place, and automatically handles the tedious parts so you can focus on moving fast.

## What It Does

1. **Tracks when pages were last updated** — Automatically scrapes your pages for content dates (`article:modified_time`, `og:updated_time`, JSON-LD `dateModified`, HTTP `Last-Modified` header) so you always know the freshness of your content.

2. **Tracks when pages were last indexed by Google** — Uses the Google Search Console URL Inspection API on a schedule to check every page's indexing status, last crawl time, and coverage state.

3. **Automatically submits pages for reindexing** — When a page has been updated after its last index date, the tool submits it to Google via the Indexing API. No manual work, no relying on writers to remember. If pages are removed from your sitemap, it submits deletion requests to Google as well. This bypasses the 10/day manual limit in Search Console with an API quota of 200/day.

4. **Categorize pages by template** — Label your URLs by template type (e.g. "blog post", "product page", "landing page") to track indexing rates and patterns across different page types. Bulk labeling makes it fast to organize thousands of URLs.

5. **Built-in analytics for user flow** — A lightweight tracker script gives you session-level journey data: where visitors land, how they move through your site, scroll depth, and where they exit. Also tracks 404s and redirects so you catch broken pages fast.

6. **Single dashboard for everything** — View all properties, all pages, all stats in one place. Filter by status, label, or search. Export everything to CSV when you need to dig deeper or share with your team.

## How It Works

The tool runs on Cloudflare Workers with a D1 (SQLite) database. Two cron schedules handle everything automatically:

| Schedule | Action |
|----------|--------|
| `:00`, `:30` | Sync sitemaps + scrape pages for content dates (every 30 min) |
| `*/7 * * * *` | Inspect one property via GSC URL Inspection API (every 7 min) |

- **Sitemap sync** parses your sitemaps (supports sitemap indexes), adds new pages, and flags removed ones for deletion.
- **Content scraping** visits pages in batches of 25, reading meta tags and headers to detect when content was last updated.
- **URL inspection** checks up to 40 URLs per run against Google's API. Each inspect run picks the least-recently-checked property, with exponential backoff for properties hitting consecutive errors so one broken site doesn't block others. The daily quota (~2,000 requests) is shared across properties.
- **Indexing submissions** automatically request reindexing for updated/new pages and deletion for removed ones (up to 200/day across all properties, 10 per run).
- **Analytics cleanup** runs once an hour to prune sessions and events older than 30 days.

## Dashboard Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Stats overview, full URL table with status filters, search, sort, labels, and bulk actions. Columns include index status, last updated, last crawled, last checked, last submitted, and traffic. |
| **Journeys** | Visitor session analytics with page trails, returning visitors, top pages, top referrers, and 404 tracking. Powered by an optional tracker script (see setup step 9). |
| **Submitted** | Timeline of every URL submitted to Google's Indexing API, with type (update vs delete) and quota usage |
| **Run History** | Logs for every inspection, sync, and scrape run with timing, URL counts, and errors |
| **Properties** | Add, edit, and manage multiple Search Console properties from a single settings page |
| **CSV Export** | Download the full URL table for the current property, filters applied |

## Setup

### 1. Google Cloud Project

You need a Google Cloud service account to authenticate with the GSC APIs. This is a one-time setup.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** > **New Project**, name it (e.g. "GSC Index Checker"), click **Create**
3. Go to **APIs & Services** > **Library**
4. Search for and enable **Google Search Console API**
5. Also enable **Web Search Indexing API** (for automatic indexing submissions)
6. Go to **APIs & Services** > **Credentials**
7. Click **Create Credentials** > **Service Account**
8. Name it (e.g. "gsc-checker"), click **Create and Continue**, skip optional steps, click **Done**
9. Click on the service account you just created > **Keys** tab > **Add Key** > **Create new key** > **JSON**
10. Save the JSON file — you'll need `client_email` and `private_key` for the Worker secrets

### 2. Clone and install

```bash
git clone https://github.com/Eddie512/gsc-index-checker.git
cd gsc-index-checker/worker
npm install
```

### 3. Create D1 database

```bash
npx wrangler d1 create gsc-index-checker
```

### 4. Configure wrangler.toml

```bash
cp wrangler.toml.example wrangler.toml
```

Paste the `database_id` from step 3 into `wrangler.toml`.

### 5. Create the schema

```bash
npx wrangler d1 execute gsc-index-checker --remote --file=schema.sql
```

### 6. Set secrets

Using the `client_email` and `private_key` from the JSON file you downloaded in step 1:

```bash
npx wrangler secret put GSC_CLIENT_EMAIL    # Service account email
npx wrangler secret put GSC_PRIVATE_KEY     # Service account private key (the full PEM block)
```

### 7. Deploy

```bash
npx wrangler deploy
```

### 8. Add your first property

Visit `/properties` on your Worker URL. Before adding a property, grant the service account access in Google Search Console:

1. Go to [Google Search Console](https://search.google.com/search-console)
2. Select your property
3. Click **Settings** > **Users and permissions** > **Add user**
4. Enter the service account email (from the JSON file's `client_email`)
5. Set permission to **Owner** and save

> **Note:** For domain properties (`sc-domain:example.com`), the service account needs access to the domain property specifically. **Restricted** permission works for inspection only; **Full/Owner** is needed for Indexing API submissions.

Then add the property in the dashboard — just enter your domain and the rest auto-fills.

### 9. Add the analytics tracker (optional)

To enable journey tracking and 404 detection on your site:

```html
<script src="https://your-worker.workers.dev/tracker.js" defer></script>
```

Tracks sessions, pageviews, scroll depth, referrers, UTM params, and returning visitors. Bot traffic is automatically filtered. Data is retained for 30 days.

## Project Structure

```
worker/
  src/
    index.tsx            # Hono entry point — routes, cron handlers
    components/          # JSX page components (Dashboard, Runs, Journeys, etc.)
    lib/                 # Shared types, constants, utilities
    db.ts                # D1 database queries
    sitemap.ts           # Sitemap parser (single + index)
    gsc-api.ts           # GSC URL Inspection API client
    indexing-api.ts      # Google Indexing API client
    google-auth.ts       # Service account JWT auth
    content-api.ts       # Page scraper for content date detection
  test/                  # Vitest tests (Cloudflare Workers pool)
  schema.sql             # D1 database schema
  wrangler.toml.example  # Cloudflare config template
  package.json
```

## License

MIT
