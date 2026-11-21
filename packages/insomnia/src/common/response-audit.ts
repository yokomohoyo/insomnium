// What a response says about the security of the API that sent it, from the
// exchange as it happened: its URL, headers, cookies and body, and what was
// sent (from the timeline). Nothing more is sent to find out, so these are the
// things one exchange can show, mostly the OWASP API Security Top 10's
// misconfigurations (API8:2023), and not what takes trying the API to find.
// The response pane's Security tab and the MCP audit_response tool show them.
import { getBoundedBodyBuffer, getTimeline, type Response } from '../models/response';

export type AuditSeverity = 'high' | 'medium' | 'low' | 'info';

export interface AuditFinding {
  // the rule's name, the same for every finding of it
  id: string;
  severity: AuditSeverity;
  // the OWASP API Security Top 10 (2023) risk it comes under
  owasp: string;
  title: string;
  detail: string;
  // the header, cookie or field it was found in: names, never a secret's value
  evidence?: string;
}

export interface AuditInput {
  url: string;
  statusCode: number;
  headers: { name: string; value: string }[];
  contentType?: string;
  // the body's text, or its start: left out for one that isn't text
  body?: string;
  // the response's timeline, for what was sent and the TLS version
  timeline?: { name: string; value: string }[];
}

const AUTHENTICATION = 'API2:2023 Broken Authentication';
const PROPERTIES = 'API3:2023 Broken Object Property Level Authorization';
const MISCONFIGURATION = 'API8:2023 Security Misconfiguration';

const SEVERITIES: AuditSeverity[] = ['high', 'medium', 'low', 'info'];

// a host on this computer or a private network, where plain http is usual
export const isLocalHost = (hostname: string) => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost'
    || host === '::1'
    || /\.(localhost|local|test|internal|lan)$/.test(host)
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^f[cd][0-9a-f]{2}:/.test(host);
};

// the request as it was sent: its method, and its headers by lower-case name
export const sentRequest = (timeline: AuditInput['timeline']) => {
  const headers = new Map<string, string>();
  let method = '';
  // (the URL as sent: the one kept with the response has lost its user name
  // and password, and is the last one when redirects were followed)
  let url = '';
  for (const { name, value } of timeline || []) {
    if (name === 'Text' && !url) {
      url = /^Preparing request to (\S+)/.exec(value)?.[1] || '';
    }
    if (name !== 'HeaderOut') {
      continue;
    }
    const [requestLine, ...lines] = value.split(/\r?\n/);
    // (the last request sent, when redirects were followed)
    method = requestLine.split(' ')[0] || method;
    for (const line of lines) {
      const colon = line.indexOf(':');
      if (colon > 0) {
        headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
      }
    }
  }
  return { method: method.toUpperCase(), headers, url };
};

export const SECRET_PARAM = /^(access_?token|id_?token|refresh_?token|token|jwt|api_?key|key|password|passwd|pwd|secret|client_?secret|auth|session(_?id)?)$/i;

// what a server shows when it fails and says too much: a stack trace's frames,
// a database's error
const ERROR_DETAILS: [RegExp, string][] = [
  [/Traceback \(most recent call last\)/, 'a Python traceback'],
  [/\bat [\w$.<>]+\([\w$]+\.(java|kt|scala|groovy):\d+\)/, 'a Java stack trace'],
  [/\bat [^\n"]{1,200}?\(?[^\s()"]+\.[cm]?[jt]s:\d+:\d+\)?/, 'a JavaScript stack trace'],
  [/\bat [\w.<>`]+\([^)\n]{0,200}\) in [^\n"]{1,200}:line \d+/, 'a .NET stack trace'],
  [/\b(Fatal error|Parse error|Warning)(<\/b>)?: [^\n]{1,300} on line (<b>)?\d+/, 'a PHP error'],
  [/\bgoroutine \d+ \[running\]/, 'a Go panic'],
  [/SQLSTATE\[|\bORA-\d{5}\b|You have an error in your SQL syntax|\bPG::\w+Error\b|\bpsycopg2\.|\bSQLITE_ERROR\b|SqlException\b/, 'a database error'],
];

// what a body shows of them, if anything: 'a Python traceback'
export const errorDetailsIn = (body: string) => ERROR_DETAILS.find(([pattern]) => pattern.test(body))?.[1];

// a JSON field that shouldn't be in a response, with a value
const SENSITIVE_FIELD = /"(password|passwd|pass_?word_?hash|password_?digest|pwd_?hash|secret|client_?secret|private_?key|ssn|social_?security_?number|credit_?card(_?number)?|card_?number|cvv|cvc)"\s*:\s*(?!null\b|""|"\*+"|false\b|true\b)/gi;

export const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;

export const jwtPart = (part: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const unique = <T>(values: T[]) => [...new Set(values)];

export function auditResponse({ url, statusCode, headers, contentType, body, timeline }: AuditInput): AuditFinding[] {
  // nothing came back to look at
  if (!statusCode) {
    return [];
  }
  const findings: AuditFinding[] = [];
  // (once each: a token can be in the body twice)
  const add = (finding: AuditFinding) => {
    if (!findings.some(({ id, evidence }) => id === finding.id && evidence === finding.evidence)) {
      findings.push(finding);
    }
  };

  const header = (name: string) => headers.find(h => h.name.toLowerCase() === name)?.value.trim() ?? '';
  const sent = sentRequest(timeline);
  const authenticated = sent.headers.has('authorization') || sent.headers.has('cookie') || sent.headers.has('x-api-key');
  const type = (contentType || header('content-type')).toLowerCase();

  const parseUrl = (value: string) => {
    try {
      return new URL(value);
    } catch {
      // audited without what its URL would say
      return null;
    }
  };
  const parsed = parseUrl(url);
  const sentUrl = sent.url ? parseUrl(sent.url) : null;
  const https = parsed?.protocol === 'https:';
  const local = !parsed || isLocalHost(parsed.hostname);

  // in transit
  if ([sentUrl, parsed].some(u => u?.protocol === 'http:' && !isLocalHost(u.hostname))) {
    add({
      id: 'plain-http',
      severity: authenticated ? 'high' : 'medium',
      owasp: MISCONFIGURATION,
      title: 'Sent over plain HTTP',
      detail: authenticated
        ? 'The request and its credentials crossed the network unencrypted, where anyone on the way can read and change them. Use https.'
        : 'The request and response crossed the network unencrypted, where anyone on the way can read and change them. Use https.',
    });
  }
  if (https && !local && !header('strict-transport-security')) {
    add({
      id: 'hsts-missing',
      severity: 'low',
      owasp: MISCONFIGURATION,
      title: 'No Strict-Transport-Security header',
      detail: 'Without it, a browser calling this API can be made to try plain http first. Send Strict-Transport-Security with a long max-age.',
    });
  }
  const weakTls = (timeline || []).map(({ name, value }) => name === 'Text' ? /SSL connection using (SSLv\d|TLSv1(?:\.[01])?)(?![.\d])/.exec(value)?.[1] : undefined).find(Boolean);
  if (weakTls) {
    add({
      id: 'weak-tls',
      severity: 'medium',
      owasp: MISCONFIGURATION,
      title: `Connected with ${weakTls}`,
      detail: 'This version of TLS has known weaknesses and is no longer supported. The server should offer TLS 1.2 or later.',
      evidence: weakTls,
    });
  }

  // credentials
  const urls = [sentUrl, parsed].flatMap(u => u ? [u] : []);
  if (urls.length) {
    const secretParams = unique(urls.flatMap(u => [...u.searchParams]).filter(([name, value]) => value && SECRET_PARAM.test(name)).map(([name]) => name));
    if (urls.some(u => u.username || u.password)) {
      secretParams.unshift('user name and password');
    }
    if (secretParams.length) {
      add({
        id: 'secret-in-url',
        severity: 'medium',
        owasp: AUTHENTICATION,
        title: 'A credential in the URL',
        detail: "URLs are kept in server and proxy logs, browser history and Referer headers, and the credential with them. Send it in a header or the request's body.",
        evidence: secretParams.join(', '),
      });
    }
  }
  const tokens: [string, string][] = [
    ...(sent.headers.get('authorization')?.match(JWT) || []).map((token): [string, string] => [token, "the request's Authorization header"]),
    ...(body?.match(JWT) || []).slice(0, 5).map((token): [string, string] => [token, 'the response body']),
  ];
  for (const [token, where] of tokens) {
    const [headerPart, payloadPart] = token.split('.');
    const jwtHeader = jwtPart(headerPart);
    const payload = jwtPart(payloadPart);
    if (!jwtHeader || !payload) {
      continue;
    }
    if (String(jwtHeader.alg).toLowerCase() === 'none') {
      add({
        id: 'jwt-unsigned',
        severity: 'high',
        owasp: AUTHENTICATION,
        title: 'An unsigned JSON Web Token',
        detail: 'Its algorithm is "none", so nothing stops its claims being changed. A server that accepts it trusts whatever the caller says.',
        evidence: where,
      });
    }
    if (payload.exp === undefined) {
      add({
        id: 'jwt-no-expiry',
        severity: 'medium',
        owasp: AUTHENTICATION,
        title: 'A JSON Web Token that never expires',
        detail: 'It has no exp claim, so one that leaks works for good. Give tokens a short life and refresh them.',
        evidence: where,
      });
    }
  }

  // headers
  if (type && !/nosniff/i.test(header('x-content-type-options'))) {
    add({
      id: 'nosniff-missing',
      severity: 'low',
      owasp: MISCONFIGURATION,
      title: 'No X-Content-Type-Options: nosniff',
      detail: "Without it a browser may guess a different content type from the body than the one sent, and run what wasn't meant to be run.",
    });
  }
  const allowOrigin = header('access-control-allow-origin');
  const allowCredentials = /^true$/i.test(header('access-control-allow-credentials'));
  if (allowOrigin === '*' && allowCredentials) {
    add({
      id: 'cors-wildcard-credentials',
      severity: 'medium',
      owasp: MISCONFIGURATION,
      title: 'CORS allows any origin, with credentials',
      detail: 'Browsers refuse this pair, and it usually means the policy was meant to be open to every site: check that the server never answers with the caller\'s own Origin and credentials allowed.',
      evidence: 'Access-Control-Allow-Origin: *, Access-Control-Allow-Credentials: true',
    });
  } else if (allowOrigin.toLowerCase() === 'null') {
    add({
      id: 'cors-null-origin',
      severity: 'medium',
      owasp: MISCONFIGURATION,
      title: 'CORS allows the null origin',
      detail: 'Any page can make its requests come from the null origin (a sandboxed frame does), so this allows every site.',
      evidence: 'Access-Control-Allow-Origin: null',
    });
  }
  const versions = headers
    .filter(({ name, value }) => /^(x-powered-by|x-aspnet-version|x-aspnetmvc-version)$/i.test(name) || (/^server$/i.test(name) && /\d+\.\d+/.test(value)))
    .map(({ name, value }) => `${name}: ${value}`);
  if (versions.length) {
    add({
      id: 'version-disclosure',
      severity: 'low',
      owasp: MISCONFIGURATION,
      title: 'The server says what it runs',
      detail: 'Software names and versions tell an attacker which known vulnerabilities to try. Remove these headers, or the versions from them.',
      evidence: versions.join(', '),
    });
  }
  const cacheControl = header('cache-control');
  if (authenticated && statusCode >= 200 && statusCode < 300 && type && (!sent.method || sent.method === 'GET') && !/no-store|private|no-cache/i.test(cacheControl)) {
    add({
      id: 'cacheable-authenticated',
      severity: 'low',
      owasp: MISCONFIGURATION,
      title: 'An authenticated response that may be cached',
      detail: "Nothing tells a shared cache or proxy to keep this to the caller it was for. Send Cache-Control: no-store (or private) with responses that depend on who's asking.",
      evidence: cacheControl ? `Cache-Control: ${cacheControl}` : 'no Cache-Control header',
    });
  }
  if (type.includes('text/html')) {
    const csp = header('content-security-policy');
    const missing = [
      ...(csp ? [] : ['Content-Security-Policy']),
      ...(header('x-frame-options') || /frame-ancestors/i.test(csp) ? [] : ['X-Frame-Options (or frame-ancestors)']),
    ];
    if (missing.length) {
      add({
        id: 'html-headers-missing',
        severity: 'low',
        owasp: MISCONFIGURATION,
        title: 'An HTML page without its security headers',
        detail: 'A content security policy limits what injected script can do, and frame options stop other sites showing the page in a frame.',
        evidence: `missing ${missing.join(', ')}`,
      });
    }
  }

  // cookies
  for (const { name, value } of headers) {
    if (name.toLowerCase() !== 'set-cookie') {
      continue;
    }
    const [pair, ...attributes] = value.split(';');
    const flags = attributes.map(attribute => attribute.trim().split('=')[0].toLowerCase());
    const missing = [
      ...(flags.includes('secure') || (!https && local) ? [] : ['Secure']),
      ...(flags.includes('httponly') ? [] : ['HttpOnly']),
      ...(flags.includes('samesite') ? [] : ['SameSite']),
    ];
    if (missing.length) {
      add({
        id: 'cookie-flags',
        // SameSite alone has a safe enough default in browsers
        severity: missing.length === 1 && missing[0] === 'SameSite' ? 'info' : 'low',
        owasp: MISCONFIGURATION,
        title: `A cookie without ${missing.join(', ')}`,
        detail: 'Secure keeps a cookie off plain http, HttpOnly keeps it from scripts in the page, and SameSite keeps other sites from sending it.',
        evidence: pair.split('=')[0].trim(),
      });
    }
  }

  // the body
  if (body) {
    const said = errorDetailsIn(body);
    if (said) {
      add({
        id: 'error-details',
        severity: 'medium',
        owasp: MISCONFIGURATION,
        title: `The response shows ${said}`,
        detail: 'It tells a caller how the server is built and where it fails. Log the details on the server, and answer with a plain error.',
      });
    }
    if (type.includes('json')) {
      const fields = unique([...body.matchAll(SENSITIVE_FIELD)].map(match => match[1]));
      if (fields.length) {
        add({
          id: 'sensitive-fields',
          severity: 'medium',
          owasp: PROPERTIES,
          title: 'The response has fields that look sensitive',
          detail: "Check that the caller is meant to see them: an API that returns its whole record leaves it to the client to hide what the user shouldn't have.",
          evidence: fields.join(', '),
        });
      }
    }
  }

  return mostSevereFirst(findings);
}

// (in the order found, within a severity)
export const mostSevereFirst = (findings: AuditFinding[]) => findings
  .map((finding, index) => ({ finding, index }))
  .sort((a, b) => SEVERITIES.indexOf(a.finding.severity) - SEVERITIES.indexOf(b.finding.severity) || a.index - b.index)
  .map(({ finding }) => finding);

// the most severe of the findings, for the tab's count
export const worstSeverity = (findings: AuditFinding[]): AuditSeverity | undefined =>
  SEVERITIES.find(severity => findings.some(finding => finding.severity === severity));

// as much of a body as is looked through, and the kinds that are text
const BODY_BYTES = 256 * 1024;
const TEXT_TYPE = /json|text|xml|html|javascript|urlencoded|yaml|csv/i;

// a response the app has kept, audited with its body and timeline
export async function auditStoredResponse(response: Response): Promise<AuditFinding[]> {
  if (response.error || !response.statusCode) {
    return [];
  }
  let body: string | undefined;
  if (!response.contentType || TEXT_TYPE.test(response.contentType)) {
    body = (await getBoundedBodyBuffer(response, BODY_BYTES)).buffer.toString('utf8');
  }
  return auditResponse({
    url: response.url,
    statusCode: response.statusCode,
    headers: response.headers,
    contentType: response.contentType,
    body,
    timeline: getTimeline(response),
  });
}
