// Akamai EdgeGrid (EG1-HMAC-SHA256): each request signed with the client's
// secret, over its method, URL, the headers chosen to sign, and a POST's body
// (up to maxBody bytes), as Akamai's edgegrid libraries do.
import crypto from 'crypto';
import { v4 as uuidV4 } from 'uuid';

export interface EdgeGridAuth {
  clientToken?: string;
  clientSecret?: string;
  accessToken?: string;
  // header names, comma-separated
  headersToSign?: string;
  maxBody?: string;
}

const MAX_BODY = 131072;

const hmac = (key: string | Buffer, data: string) => crypto.createHmac('sha256', key).update(data).digest('base64');

// yyyyMMddTHH:mm:ss+0000, in UTC
export const edgeGridTimestamp = (date = new Date()) =>
  `${date.toISOString().replace(/[-]/g, '').replace(/\.\d{3}Z$/, '')}+0000`;

export function edgeGridHeader(
  auth: EdgeGridAuth,
  request: { method: string; url: string; headers: { name: string; value: string }[]; body?: string },
  { timestamp = edgeGridTimestamp(), nonce = uuidV4() }: { timestamp?: string; nonce?: string } = {},
) {
  if (!auth.clientToken || !auth.clientSecret || !auth.accessToken) {
    throw new Error('EdgeGrid needs the client token, client secret and access token');
  }
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const toSign = (auth.headersToSign || '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean);
  const canonicalHeaders = toSign
    .map(name => request.headers.find(header => header.name.toLowerCase() === name))
    .filter((header): header is { name: string; value: string } => Boolean(header))
    .map(header => `${header.name.toLowerCase()}:${header.value.trim().replace(/\s+/g, ' ')}`)
    .join('\t');
  const maxBody = Number(auth.maxBody) > 0 ? Number(auth.maxBody) : MAX_BODY;
  const body = method === 'POST' && request.body ? Buffer.from(request.body).subarray(0, maxBody) : null;
  const contentHash = body?.length ? crypto.createHash('sha256').update(body).digest('base64') : '';

  const unsigned = `EG1-HMAC-SHA256 client_token=${auth.clientToken};access_token=${auth.accessToken};timestamp=${timestamp};nonce=${nonce};`;
  const dataToSign = [
    method,
    url.protocol.replace(':', ''),
    url.host.toLowerCase(),
    `${url.pathname}${url.search}`,
    canonicalHeaders,
    contentHash,
    unsigned,
  ].join('\t');
  const signingKey = hmac(auth.clientSecret, timestamp);
  return `${unsigned}signature=${hmac(signingKey, dataToSign)}`;
}
