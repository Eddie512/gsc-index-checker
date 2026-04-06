/**
 * Google Indexing API client.
 *
 * Submits URLs to Google for faster crawling/indexing.
 * Quota: 200 URLs per day per project.
 */

import { getAccessToken, SCOPES } from './google-auth';

const INDEXING_URL =
  'https://indexing.googleapis.com/v3/urlNotifications:publish';

export type IndexingType = 'URL_UPDATED' | 'URL_DELETED';

export interface IndexingResult {
  success: boolean;
  error?: string;
}

/**
 * Submit a single URL to the Google Indexing API.
 */
export async function submitUrl(
  url: string,
  type: IndexingType,
  clientEmail: string,
  privateKey: string
): Promise<IndexingResult> {
  const token = await getAccessToken(clientEmail, privateKey, SCOPES.INDEXING);

  const response = await fetch(INDEXING_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, type }),
  });

  if (!response.ok) {
    const text = await response.text();
    return { success: false, error: `${response.status}: ${text}` };
  }

  return { success: true };
}
