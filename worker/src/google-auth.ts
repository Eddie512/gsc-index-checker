/**
 * Google Service Account JWT authentication for Cloudflare Workers.
 *
 * Signs a JWT with the service account private key using Web Crypto API,
 * then exchanges it for an access token via Google's OAuth2 endpoint.
 * Supports multiple scopes with scope-aware token caching.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Available Google API scopes. */
export const SCOPES = {
  INSPECTION: 'https://www.googleapis.com/auth/webmasters.readonly',
  INDEXING: 'https://www.googleapis.com/auth/indexing',
} as const;

/** Convert a PEM-encoded PKCS#8 private key to an ArrayBuffer. */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Base64url-encode an ArrayBuffer or string. */
function base64url(input: ArrayBuffer | string): string {
  let b64: string;
  if (typeof input === 'string') {
    b64 = btoa(input);
  } else {
    const bytes = new Uint8Array(input);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    b64 = btoa(binary);
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Import the RSA private key for signing. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const keyData = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/** Create and sign a JWT for the Google Service Account. */
async function createSignedJwt(
  clientEmail: string,
  privateKey: string,
  scope: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600, // 1 hour
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64url(signature)}`;
}

/** Scope-aware token cache to avoid re-authenticating on every API call. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Get a valid Google access token for the given scope, using cache when possible.
 * Returns the Bearer access token string.
 */
export async function getAccessToken(
  clientEmail: string,
  privateKey: string,
  scope: string = SCOPES.INSPECTION
): Promise<string> {
  const now = Date.now();
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.token;
  }

  const jwt = await createSignedJwt(clientEmail, privateKey, scope);

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  tokenCache.set(scope, {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  });

  return data.access_token;
}
