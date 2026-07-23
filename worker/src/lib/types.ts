/**
 * Shared type definitions.
 */

export interface Env {
  DB: D1Database;
  /** Global response cache for /api/traffic (KV, unlike per-colo caches.default). */
  TRAFFIC_CACHE: KVNamespace;
  GSC_CLIENT_EMAIL: string;
  GSC_PRIVATE_KEY: string;
}
