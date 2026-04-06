/**
 * GSC URL Inspection API client.
 */

import { getAccessToken } from './google-auth';

const INSPECT_URL =
  'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
export interface InspectionResult {
  indexStatus: string;
  coverageState: string;
  lastCrawlTime: string | null;
  crawlStatus: string;
  pageFetchState: string;
  robotsStatus: string;
  referringUrls: string[];
}

/**
 * Inspect a single URL via the GSC URL Inspection API.
 * Returns parsed result or throws on error.
 */
export async function inspectUrl(
  url: string,
  siteUrl: string,
  clientEmail: string,
  privateKey: string
): Promise<InspectionResult> {
  const token = await getAccessToken(clientEmail, privateKey);

  const response = await fetch(INSPECT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inspectionUrl: url,
      siteUrl,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GSC API error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    inspectionResult?: {
      indexStatusResult?: {
        verdict?: string;
        coverageState?: string;
        lastCrawlTime?: string;
        crawledAs?: string;
        pageFetchState?: string;
        robotsTxtState?: string;
        referringUrls?: string[];
      };
    };
  };

  const index = data.inspectionResult?.indexStatusResult || {};

  return {
    indexStatus: index.verdict || 'UNKNOWN',
    coverageState: index.coverageState || '',
    lastCrawlTime: index.lastCrawlTime || null,
    crawlStatus: index.crawledAs || '',
    pageFetchState: index.pageFetchState || '',
    robotsStatus: index.robotsTxtState || '',
    referringUrls: index.referringUrls || [],
  };
}
