/** How many URLs to inspect per property per cron run. */
export const BATCH_SIZE = 40;

/** Delay between API calls (ms). */
export const API_DELAY_MS = 200;

/** Maximum Indexing API submissions per day (global across all properties). */
export const INDEXING_DAILY_QUOTA = 200;

/** Max indexing submissions per cron run. */
export const INDEXING_BATCH_PER_RUN = 10;

/** Pattern to detect bot/crawler user agents. */
export const BOT_PATTERN = /bot|crawl|spider|slurp|semrush|ahref|yandex|baidu|bytespider|gptbot|facebook|twitter|discord|telegram|whatsapp|preview|headless|phantom|puppet|selenium/;
