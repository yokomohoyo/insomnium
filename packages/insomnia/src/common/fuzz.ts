// Fuzzing a request: the same request sent many times, each with one value
// swapped for a payload, and the answers compared with the request's own. The
// positions are the places a value can go (a query parameter, a path segment,
// a header, a field of the body); the payloads come from lists (SQL, path
// traversal, odd types, fields to slip in) or are the user's own.
//
// This file finds the positions, puts a payload in one, and says what an
// answer shows. Sending is the caller's (network/fuzz-run.ts), and so are the
// request's scripts, which run for every attempt: a pre-request script can
// sign or reshape what's sent, and an after-response script can decide what
// counts and clean up what an attempt made.
import { errorDetailsIn } from './response-audit';

export type FuzzPointKind = 'query' | 'path' | 'header' | 'json' | 'form' | 'json-new';

export interface FuzzPoint {
  // the same for the same place every time the request is rendered
  id: string;
  kind: FuzzPointKind;
  // "Query: status", "Path: 2nd part (7)", "Body: user.name"
  label: string;
  original: string;
  // worth ticking by default: where an API takes its input
  suggested: boolean;
}

// the parts of a rendered request a payload can go in
export interface FuzzTarget {
  url: string;
  parameters: { name: string; value: string; disabled?: boolean }[];
  headers: { name: string; value: string; disabled?: boolean }[];
  body: { mimeType?: string | null; text?: string; params?: { name: string; value: string; disabled?: boolean; type?: string; fileName?: string }[] };
}

export interface FuzzPayload {
  // as text: what goes in a URL, a header, a form field, and what's shown
  value: string;
  // in a JSON body, the value itself when it isn't a string: null, true, [], {"$ne":null}
  json?: unknown;
  // for a new field of a JSON body: its name
  field?: string;
}

export interface FuzzList {
  id: string;
  name: string;
  about: string;
  payloads: FuzzPayload[];
}

const text = (...values: string[]): FuzzPayload[] => values.map(value => ({ value }));
const typed = (...values: unknown[]): FuzzPayload[] => values.map(json => ({ value: JSON.stringify(json), json }));
const field = (name: string, json: unknown): FuzzPayload => ({ field: name, value: `${name}=${JSON.stringify(json)}`, json });

export const FUZZ_LISTS: FuzzList[] = [
  {
    id: 'sql',
    name: 'SQL',
    about: 'Quotes and fragments that break a query built from the value',
    payloads: text("'", '"', "' OR '1'='1", "' OR 1=1--", "1' ORDER BY 100--", "') OR ('1'='1", '1; SELECT 1', "' UNION SELECT NULL--", '1 AND SLEEP(3)', "'; WAITFOR DELAY '0:0:3'--"),
  },
  {
    id: 'nosql',
    name: 'NoSQL',
    about: 'Operators a document database takes in place of a value',
    payloads: [...typed({ $ne: null }, { $gt: '' }, { $regex: '.*' }, { $where: 'true' }), ...text('[$ne]=1', "';return true;//")],
  },
  {
    id: 'traversal',
    name: 'Paths',
    about: 'Ways out of the folder a file or key is read from',
    payloads: text('../', '../../../../etc/passwd', '..\\..\\..\\..\\windows\\win.ini', '....//....//etc/passwd', '%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/etc/passwd', 'file:///etc/passwd'),
  },
  {
    id: 'script',
    name: 'Markup and templates',
    about: 'What a page or a template engine would run if the value reached one',
    payloads: text('<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', '{{7*7}}', '${7*7}', '<%= 7*7 %>', '#{7*7}', 'javascript:alert(1)'),
  },
  {
    id: 'commands',
    name: 'Commands',
    about: 'Fragments a shell would run if the value reached one',
    payloads: text('; id', '| id', '`id`', '$(id)', '& whoami', '|| sleep 3'),
  },
  {
    id: 'ids',
    name: 'Other ids',
    about: "Ids that aren't the caller's: other records, none, and the edges",
    payloads: text('0', '1', '2', '-1', '999999999', '00000000-0000-0000-0000-000000000000', 'admin', 'me', '*'),
  },
  {
    id: 'types',
    name: 'Odd values',
    about: 'The wrong type, nothing, and far too much',
    payloads: [...typed(null, true, false, [], {}, -1, 0, 1e308, ''), ...text('null', 'undefined', 'NaN', '%00', 'A'.repeat(5000))],
  },
  {
    id: 'fields',
    name: 'Fields to slip in',
    about: "Fields a caller shouldn't be able to set, added to a JSON body (mass assignment)",
    payloads: [
      field('role', 'admin'), field('isAdmin', true), field('is_admin', true), field('admin', true),
      field('verified', true), field('emailVerified', true), field('active', true),
      field('balance', 999999), field('credit', 999999), field('ownerId', 1), field('userId', 1), field('user_id', 1),
      field('permissions', ['*']), field('scope', 'admin'), field('id', 1),
    ],
  },
];

// one payload a line; "name=value" is a field to slip in, its value read as JSON when it is
export const customPayloads = (lines: string): FuzzPayload[] => lines.split(/\r?\n/).filter(line => line !== '').map(line => {
  const named = /^([A-Za-z_][\w.-]*)=(.*)$/.exec(line);
  let json: unknown;
  let isJson = false;
  try {
    json = JSON.parse(named ? named[2] : line);
    isJson = typeof json !== 'string';
  } catch {
    // just text
  }
  return {
    value: line,
    ...(named ? { field: named[1], json: isJson ? json : named[2] } : isJson ? { json } : {}),
  };
});

const SKIPPED_HEADERS = /^(content-length|content-type|host|connection|accept-encoding|transfer-encoding)$/i;
const LOOKS_LIKE_ID = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24})$/i;
const MAX_JSON_POINTS = 60;

const parseUrl = (url: string) => {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`);
  } catch {
    return null;
  }
};

const isJson = ({ mimeType, text: body }: FuzzTarget['body']) => Boolean(body && (/json/i.test(mimeType || '') || /^\s*[{[]/.test(body)));
const parseBody = (body: FuzzTarget['body']): unknown => {
  if (!isJson(body)) {
    return undefined;
  }
  try {
    return JSON.parse(body.text!);
  } catch {
    return undefined;
  }
};

// the leaves of a JSON value, by their path: ["user", "name"], ["items", 0, "id"]
const leaves = (value: unknown, path: (string | number)[] = [], found: (string | number)[][] = []) => {
  if (found.length >= MAX_JSON_POINTS) {
    return found;
  }
  if (Array.isArray(value) && value.length) {
    // (the first of a list stands for the rest)
    leaves(value[0], [...path, 0], found);
  } else if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) {
    Object.keys(value).forEach(key => leaves((value as Record<string, unknown>)[key], [...path, key], found));
  } else {
    found.push(path);
  }
  return found;
};
const pathLabel = (path: (string | number)[]) => path.map((part, index) => typeof part === 'number' ? `[${part}]` : index ? `.${part}` : part).join('') || '(the whole body)';
const at = (value: unknown, path: (string | number)[]) => path.reduce<unknown>((inner, part) => (inner as Record<string | number, unknown>)?.[part], value);
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;

export function fuzzPoints(target: FuzzTarget): FuzzPoint[] {
  const points: FuzzPoint[] = [];
  const url = parseUrl(target.url);

  target.parameters.forEach((parameter, index) => {
    if (!parameter.disabled && parameter.name) {
      points.push({ id: `query:p${index}`, kind: 'query', label: `Query: ${parameter.name}`, original: parameter.value, suggested: true });
    }
  });
  if (url) {
    [...url.searchParams].forEach(([name, value], index) => {
      points.push({ id: `query:u${index}`, kind: 'query', label: `Query: ${name}`, original: value, suggested: true });
    });
    url.pathname.split('/').forEach((part, index) => {
      if (part) {
        const original = decodeURIComponent(part);
        points.push({ id: `path:${index}`, kind: 'path', label: `Path: ${ordinal(index)} part (${original})`, original, suggested: LOOKS_LIKE_ID.test(original) });
      }
    });
  }
  target.headers.forEach((header, index) => {
    if (!header.disabled && header.name && !SKIPPED_HEADERS.test(header.name)) {
      points.push({ id: `header:${index}`, kind: 'header', label: `Header: ${header.name}`, original: header.value, suggested: false });
    }
  });
  const body = parseBody(target.body);
  if (body !== undefined) {
    for (const path of leaves(body)) {
      const original = at(body, path);
      points.push({ id: `json:${JSON.stringify(path)}`, kind: 'json', label: `Body: ${pathLabel(path)}`, original: typeof original === 'string' ? original : JSON.stringify(original), suggested: true });
    }
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      points.push({ id: 'json-new', kind: 'json-new', label: 'Body: a new field', original: '', suggested: true });
    }
  } else {
    (target.body.params || []).forEach((parameter, index) => {
      if (!parameter.disabled && parameter.name && parameter.type !== 'file' && !parameter.fileName) {
        points.push({ id: `form:${index}`, kind: 'form', label: `Form: ${parameter.name}`, original: parameter.value, suggested: true });
      }
    });
  }
  return points;
}

// What a run tries, from what was asked for by name (an MCP client, a
// pipeline): positions by id or label, or "all", the suggested ones when none
// are named; payload lists by id; and one's own payloads, one a line. Throws,
// naming what there is, for a position or list that isn't there
export const chooseFuzz = (all: FuzzPoint[], { positions = [], lists = [], payloads = '' }: { positions?: string[]; lists?: string[]; payloads?: string }) => {
  let points: FuzzPoint[];
  if (!positions.length) {
    points = all.filter(({ suggested }) => suggested);
  } else if (positions.some(position => position.trim().toLowerCase() === 'all')) {
    points = all;
  } else {
    points = positions.map(wanted => {
      const name = wanted.trim().toLowerCase();
      const found = all.find(({ id }) => id === wanted.trim()) || all.find(({ label }) => label.toLowerCase() === name)
        // "Path: 2nd part" for "Path: 2nd part (7)": the value in brackets changes
        || all.find(({ label }) => label.toLowerCase().replace(/ \(.*\)$/, '') === name);
      if (!found) {
        throw new Error(`no position '${wanted}' in the request. It has: ${all.map(({ label }) => label).join(', ') || 'none'}`);
      }
      return found;
    });
    points = points.filter((point, index) => points.indexOf(point) === index);
  }
  if (!points.length) {
    throw new Error(`the request has no ${positions.length ? '' : 'likely '}positions to put payloads in${all.length && !positions.length ? `. It has: ${all.map(({ label }) => label).join(', ')}` : ''}`);
  }
  const unknown = lists.filter(id => !FUZZ_LISTS.some(list => list.id === id));
  if (unknown.length) {
    throw new Error(`no payload list named ${unknown.join(', ')}. The lists are: ${FUZZ_LISTS.map(({ id }) => id).join(', ')}`);
  }
  const own = customPayloads(payloads);
  if (!lists.length && !own.length) {
    throw new Error(`nothing to try: name payload lists (${FUZZ_LISTS.map(({ id }) => id).join(', ')}) or give your own payloads`);
  }
  const chosen = FUZZ_LISTS.filter(({ id }) => lists.includes(id));
  return {
    points,
    payloads: [...chosen.flatMap(list => list.payloads), ...own],
    // as the dialog names them
    lists: [...chosen.map(({ name }) => name), ...(own.length ? [`${own.length} of your own`] : [])],
  };
};

// whether a payload goes in a position: a field to slip in goes in the body's
// new field and nowhere else, and nothing else goes there
export const payloadFits = (point: Pick<FuzzPoint, 'kind'>, payload: FuzzPayload) => (point.kind === 'json-new') === Boolean(payload.field);

// the attempts a run makes: each position with each payload that fits it, one at a time
export const fuzzAttempts = (points: FuzzPoint[], payloads: FuzzPayload[]) =>
  points.flatMap(point => payloads.filter(payload => payloadFits(point, payload)).map(payload => ({ point, payload })));

// The target with the payload in one position; everything else as it was.
// Null when the position isn't there any more (a script changed the request).
export function withPayload<T extends FuzzTarget>(target: T, pointId: string, payload: FuzzPayload): T | null {
  const [kind, rest] = [pointId.slice(0, pointId.indexOf(':') === -1 ? pointId.length : pointId.indexOf(':')), pointId.slice(pointId.indexOf(':') + 1)];
  const next: T = { ...target, parameters: target.parameters.map(p => ({ ...p })), headers: target.headers.map(h => ({ ...h })), body: { ...target.body, params: target.body.params?.map(p => ({ ...p })) } };
  const url = parseUrl(target.url);
  const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(target.url);
  const written = (changed: URL) => hadScheme ? changed.toString() : changed.toString().replace(/^http:\/\//, '');

  if (kind === 'query' && rest.startsWith('p')) {
    const parameter = next.parameters[Number(rest.slice(1))];
    if (!parameter) {
      return null;
    }
    parameter.value = payload.value;
    return next;
  }
  if (kind === 'query' && url) {
    const entries = [...url.searchParams];
    const index = Number(rest.slice(1));
    if (!entries[index]) {
      return null;
    }
    entries[index] = [entries[index][0], payload.value];
    url.search = new URLSearchParams(entries).toString();
    next.url = written(url);
    return next;
  }
  if (kind === 'path' && url) {
    const parts = url.pathname.split('/');
    const index = Number(rest);
    if (!parts[index]) {
      return null;
    }
    parts[index] = encodeURIComponent(payload.value);
    url.pathname = parts.join('/');
    next.url = written(url);
    return next;
  }
  if (kind === 'header') {
    const header = next.headers[Number(rest)];
    if (!header) {
      return null;
    }
    // (a header can't hold a line break: what would be one is sent as text)
    header.value = payload.value.replace(/[\r\n]/g, ' ');
    return next;
  }
  if (kind === 'form') {
    const parameter = next.body.params?.[Number(rest)];
    if (!parameter) {
      return null;
    }
    parameter.value = payload.value;
    return next;
  }
  const body = parseBody(target.body);
  if (body === undefined) {
    return null;
  }
  const value = 'json' in payload ? payload.json : payload.value;
  if (kind === 'json-new') {
    if (!payload.field || !body || typeof body !== 'object' || Array.isArray(body)) {
      return null;
    }
    next.body.text = JSON.stringify({ ...body, [payload.field]: value });
    return next;
  }
  if (kind === 'json') {
    const path: (string | number)[] = JSON.parse(rest);
    if (!path.length) {
      next.body.text = JSON.stringify(value);
      return next;
    }
    const copy = JSON.parse(JSON.stringify(body));
    const parent = at(copy, path.slice(0, -1)) as Record<string | number, unknown> | undefined;
    if (!parent || typeof parent !== 'object') {
      return null;
    }
    parent[path[path.length - 1]] = value;
    next.body.text = JSON.stringify(copy);
    return next;
  }
  return null;
}

// what came back, for the request as it is or for an attempt
export interface FuzzExchange {
  statusCode: number;
  body: string;
  // the body's size, as received
  bytes: number;
  elapsed: number;
  error?: string;
  // the assertions and script tests that failed: a script's way to say what counts
  failedChecks?: string[];
}

export interface FuzzFlag {
  id: 'server-error' | 'error-details' | 'evaluated' | 'accepted' | 'slow' | 'check-failed' | 'reflected' | 'status' | 'size' | 'no-answer';
  label: string;
  // worth looking at on its own, not just a difference
  notable: boolean;
}

const statusClass = (status: number) => Math.floor(status / 100);
const ok = (status: number) => status >= 200 && status < 300;

// What an attempt's answer shows next to the request's own
export function judgeAttempt(baseline: FuzzExchange, attempt: FuzzExchange, payload: FuzzPayload): FuzzFlag[] {
  const flags: FuzzFlag[] = [];
  const flag = (id: FuzzFlag['id'], label: string, notable = true) => flags.push({ id, label, notable });

  if (!attempt.statusCode) {
    flag('no-answer', attempt.error ? `No answer: ${attempt.error}` : 'No answer', Boolean(baseline.statusCode));
    return flags;
  }
  if (attempt.statusCode >= 500 && baseline.statusCode < 500) {
    flag('server-error', `The server failed (${attempt.statusCode})`);
  }
  const said = errorDetailsIn(attempt.body);
  if (said && said !== errorDetailsIn(baseline.body)) {
    flag('error-details', `The answer shows ${said}`);
  }
  // {{7*7}} and its kind: 49 where there was none says something worked it out
  if (/7\s*\*\s*7/.test(payload.value) && /\b49\b/.test(attempt.body) && !/\b49\b/.test(baseline.body) && !attempt.body.includes(payload.value)) {
    flag('evaluated', 'The value was worked out, not just stored (7*7 came back as 49)');
  }
  if (payload.field && ok(attempt.statusCode)) {
    const came = new RegExp(`"${payload.field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*${JSON.stringify(payload.json).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(attempt.body);
    flag('accepted', came ? `The field came back as sent: ${payload.field}` : `The request with ${payload.field} added was accepted (${attempt.statusCode})`, came);
  }
  if (baseline.elapsed > 0 && attempt.elapsed > 2000 && attempt.elapsed > baseline.elapsed * 5) {
    flag('slow', `It took ${(attempt.elapsed / 1000).toFixed(1)} s, against ${Math.round(baseline.elapsed)} ms`);
  }
  for (const check of attempt.failedChecks || []) {
    flag('check-failed', `Failed: ${check}`);
  }
  if (/[<>"'`]/.test(payload.value) && payload.value.length >= 4 && attempt.body.includes(payload.value) && !baseline.body.includes(payload.value)) {
    flag('reflected', 'The value came back in the answer as it was sent', false);
  }
  if (statusClass(attempt.statusCode) !== statusClass(baseline.statusCode) && !flags.some(({ id }) => id === 'server-error')) {
    flag('status', `${attempt.statusCode} where the request itself got ${baseline.statusCode || 'no answer'}`, false);
  }
  if (baseline.bytes > 0 && Math.abs(attempt.bytes - baseline.bytes) / baseline.bytes > 0.2 && statusClass(attempt.statusCode) === statusClass(baseline.statusCode)) {
    flag('size', `${attempt.bytes} bytes, against ${baseline.bytes}`, false);
  }
  return flags;
}
