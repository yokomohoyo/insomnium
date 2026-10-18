// What a token request leaves in the responses folder, for its Response
// Timeline: the form it sent (a code, a refresh token, a password, the
// client's secret or assertion) and the tokens it got back, with those values
// replaced. The tokens themselves are kept in the OAuth2Token, which is stored
// encrypted (common/credential-guard.ts); the responses folder isn't.
import fs from 'fs';
import zlib from 'zlib';

import { database as db } from '../../common/database';
import type { ResponseTimelineEntry } from '../../main/network/libcurl-promise';
import * as models from '../../models';
import type { OAuth2Token } from '../../models/o-auth-2-token';
import type { Response } from '../../models/response';

export const REDACTED = '••••••';

// access_token, refresh_token, id_token, subject_token, token; client_secret;
// password; client_assertion and the jwt-bearer assertion; code_verifier; the
// code (and a device code)
const isSecret = (key: string) => /(^|_)token$|secret|password|assertion$|verifier$|^(device_)?code$/i.test(key);

const decoded = (text: string) => {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
};

// form-encoded text, its secret values replaced and the rest as it was;
// anything else as it is
export function redactForm(text: string) {
  if (!/^[^\s=&]+=[^\s&]*(&[^\s=&]+=[^\s&]*)*$/.test(text.trim())) {
    return text;
  }
  return text.split('&').map(pair => {
    const at = pair.indexOf('=');
    return isSecret(decoded(pair.slice(0, at))) && pair.slice(at + 1).trim() ? `${pair.slice(0, at)}=${REDACTED}` : pair;
  }).join('&');
}

const redactJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, isSecret(key) && typeof inner === 'string' && inner ? REDACTED : redactJson(inner)]));
  }
  return value;
};

// a token response's body (JSON, or form-encoded as GitHub's is unless asked
// for JSON), or the form a token request sent
export function redactBody(text: string) {
  try {
    const data = JSON.parse(text);
    const redacted = redactJson(data);
    return JSON.stringify(redacted) === JSON.stringify(data) ? text : JSON.stringify(redacted);
  } catch {
    return redactForm(text);
  }
}

// the credentials of an Authorization header (a client's, sent as Basic), its scheme kept
const redactAuthorization = (headers: string) => headers.replace(/^((?:proxy-)?authorization:[ \t]*)(.*)$/gim, (_line, name: string, value: string) => {
  const [scheme, ...credentials] = value.trim().split(/\s+/);
  return credentials.length ? `${name}${scheme} ${REDACTED}` : `${name}${REDACTED}`;
});

export function redactTimeline(timeline: ResponseTimelineEntry[]) {
  return timeline.map(entry => {
    if (entry.name === 'HeaderOut') {
      return { ...entry, value: redactAuthorization(entry.value) };
    }
    if (entry.name === 'DataOut') {
      return { ...entry, value: redactBody(entry.value) };
    }
    return entry;
  });
}

const rewrite = async (filepath: string, redact: (text: string) => string, zipped = false) => {
  const raw = await fs.promises.readFile(filepath).catch(() => null);
  if (!raw) {
    return;
  }
  // (a response said to be zipped may not be: getBodyBuffer reads it as it is then)
  let unzipped: Buffer | null = null;
  if (zipped) {
    try {
      unzipped = zlib.gunzipSync(raw);
    } catch {
      unzipped = null;
    }
  }
  const text = (unzipped || raw).toString('utf8');
  const redacted = redact(text);
  if (redacted !== text) {
    await fs.promises.writeFile(filepath, unzipped ? zlib.gzipSync(redacted) : redacted);
  }
};

// A token request's response files, without the secrets: once the tokens have
// been read from it, and for those kept from before
export async function redactTokenResponse(response: Pick<Response, 'bodyPath' | 'timelinePath' | 'bodyCompression'>) {
  if (response.bodyPath) {
    await rewrite(response.bodyPath, redactBody, response.bodyCompression === 'zip').catch(err => console.warn('[oauth2] Could not redact a token response', err.message));
  }
  if (response.timelinePath) {
    await rewrite(response.timelinePath, text => {
      const timeline = JSON.parse(text) as ResponseTimelineEntry[];
      const redacted = redactTimeline(timeline);
      return JSON.stringify(redacted) === JSON.stringify(timeline) ? text : JSON.stringify(redacted);
    }).catch(err => console.warn('[oauth2] Could not redact a token request timeline', err.message));
  }
}

// The token responses already kept, from before they were redacted: those of
// every request with an OAuth 2 token, whose token requests are the request's
// id plus .other (get-token.ts)
export async function redactStoredTokenResponses() {
  const tokens = await db.all<OAuth2Token>(models.oAuth2Token.type);
  const parents = [...new Set(tokens.map(token => `${token.parentId}.other`))];
  if (!parents.length) {
    return;
  }
  for (const response of await db.find<Response>(models.response.type, { parentId: { $in: parents } })) {
    await redactTokenResponse(response);
  }
}
