/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import { customPayloads, FUZZ_LISTS, fuzzAttempts, type FuzzExchange, fuzzPoints, type FuzzTarget, judgeAttempt, payloadFits, withPayload } from '../fuzz';

const target = (patch: Partial<FuzzTarget> = {}): FuzzTarget => ({
  url: 'https://shop.example.com/users/42/orders?status=open&page=2',
  parameters: [{ name: 'sort', value: 'date' }, { name: 'off', value: 'x', disabled: true }],
  headers: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Tenant', value: 'acme' }, { name: 'Authorization', value: 'Bearer abc' }],
  body: { mimeType: 'application/json', text: JSON.stringify({ name: 'Ana', address: { city: 'Lyon' }, items: [{ id: 7, qty: 1 }, { id: 8, qty: 2 }], note: null }) },
  ...patch,
});
const ids = (points: { id: string }[]) => points.map(({ id }) => id);

describe('fuzzPoints()', () => {
  it('finds the places a value can go: the query, the path, the headers, the body', () => {
    const points = fuzzPoints(target());

    expect(points.map(({ id, label, original }) => [id, label, original])).toEqual([
      ['query:p0', 'Query: sort', 'date'],
      ['query:u0', 'Query: status', 'open'],
      ['query:u1', 'Query: page', '2'],
      ['path:1', 'Path: 1st part (users)', 'users'],
      ['path:2', 'Path: 2nd part (42)', '42'],
      ['path:3', 'Path: 3rd part (orders)', 'orders'],
      ['header:1', 'Header: X-Tenant', 'acme'],
      ['header:2', 'Header: Authorization', 'Bearer abc'],
      ['json:["name"]', 'Body: name', 'Ana'],
      ['json:["address","city"]', 'Body: address.city', 'Lyon'],
      ['json:["items",0,"id"]', 'Body: items[0].id', '7'],
      ['json:["items",0,"qty"]', 'Body: items[0].qty', '1'],
      ['json:["note"]', 'Body: note', 'null'],
      ['json-new', 'Body: a new field', ''],
    ]);
  });

  it('suggests where an API takes its input, and the parts of the path that look like ids', () => {
    const suggested = ids(fuzzPoints(target()).filter(point => point.suggested));

    expect(suggested).toContain('query:u0');
    expect(suggested).toContain('path:2');
    expect(suggested).toContain('json:["name"]');
    expect(suggested).toContain('json-new');
    expect(suggested).not.toContain('path:1');
    expect(suggested).not.toContain('header:2');
  });

  it("finds a form's fields, not its files", () => {
    const points = fuzzPoints(target({ body: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'user', value: 'ana' }, { name: 'avatar', value: '', type: 'file', fileName: '/a.png' }, { name: 'off', value: 'x', disabled: true }] } }));

    expect(ids(points).filter(id => id.startsWith('form') || id.startsWith('json'))).toEqual(['form:0']);
  });

  it('has no new field to offer for a body that is a list, or not JSON', () => {
    expect(ids(fuzzPoints(target({ body: { mimeType: 'application/json', text: '[1,2]' } })))).not.toContain('json-new');
    expect(ids(fuzzPoints(target({ body: { mimeType: 'text/plain', text: 'hello' } }))).some(id => id.startsWith('json'))).toBe(false);
    expect(ids(fuzzPoints(target({ body: {} }))).some(id => id.startsWith('json'))).toBe(false);
  });

  it('copes with a URL without a scheme, and one that is no URL', () => {
    expect(ids(fuzzPoints(target({ url: 'localhost:4999/orders/7?x=1', parameters: [], headers: [], body: {} })))).toEqual(['query:u0', 'path:1', 'path:2']);
    expect(fuzzPoints(target({ url: '', parameters: [], headers: [], body: {} }))).toEqual([]);
  });
});

describe('withPayload()', () => {
  const put = (id: string, value: string, extra: object = {}) => withPayload(target(), id, { value, ...extra })!;

  it('puts the payload in the one position, and leaves the rest', () => {
    expect(put('query:p0', "' OR 1=1--").parameters[0]).toEqual({ name: 'sort', value: "' OR 1=1--" });
    expect(put('query:u0', "a'b").url).toBe('https://shop.example.com/users/42/orders?status=a%27b&page=2');
    expect(put('path:2', '../7').url).toBe('https://shop.example.com/users/..%2F7/orders?status=open&page=2');
    expect(put('header:1', 'x').headers[1]).toEqual({ name: 'X-Tenant', value: 'x' });
    expect(JSON.parse(put('json:["address","city"]', 'Paris').body.text!)).toMatchObject({ name: 'Ana', address: { city: 'Paris' } });
    expect(JSON.parse(put('json:["items",0,"id"]', '999').body.text!).items).toEqual([{ id: '999', qty: 1 }, { id: 8, qty: 2 }]);
  });

  it("doesn't change the request it was given", () => {
    const original = target();
    const before = JSON.stringify(original);

    withPayload(original, 'query:p0', { value: 'x' });
    withPayload(original, 'header:1', { value: 'x' });
    withPayload(original, 'json:["name"]', { value: 'x' });

    expect(JSON.stringify(original)).toBe(before);
  });

  it('puts a value of another type in a JSON body as that type, and as text anywhere else', () => {
    const operator = { value: '{"$ne":null}', json: { $ne: null } };

    expect(JSON.parse(withPayload(target(), 'json:["name"]', operator)!.body.text!).name).toEqual({ $ne: null });
    expect(withPayload(target(), 'query:p0', operator)!.parameters[0].value).toBe('{"$ne":null}');
    expect(JSON.parse(withPayload(target(), 'json:["note"]', { value: 'true', json: true })!.body.text!).note).toBe(true);
  });

  it('adds a field to a JSON body', () => {
    const body = JSON.parse(withPayload(target(), 'json-new', { value: 'isAdmin=true', field: 'isAdmin', json: true })!.body.text!);

    expect(body).toMatchObject({ name: 'Ana', isAdmin: true });
  });

  it('keeps a line break out of a header', () => {
    expect(put('header:1', 'a\r\nX-Injected: 1').headers[1].value).toBe('a  X-Injected: 1');
  });

  it('keeps a URL without a scheme without one', () => {
    expect(withPayload(target({ url: 'localhost:4999/orders/7' }), 'path:2', { value: '8' })!.url).toBe('localhost:4999/orders/8');
  });

  it("is nothing when the position isn't there", () => {
    expect(withPayload(target(), 'query:p9', { value: 'x' })).toBeNull();
    expect(withPayload(target(), 'header:9', { value: 'x' })).toBeNull();
    expect(withPayload(target({ body: {} }), 'json:["name"]', { value: 'x' })).toBeNull();
    expect(withPayload(target({ body: { mimeType: 'application/json', text: '[1]' } }), 'json-new', { value: 'a=1', field: 'a', json: 1 })).toBeNull();
    expect(withPayload(target(), 'form:0', { value: 'x' })).toBeNull();
  });
});

describe('the payloads', () => {
  it('come in lists, each with a name and what it is for', () => {
    expect(FUZZ_LISTS.map(({ id }) => id)).toEqual(['sql', 'nosql', 'traversal', 'script', 'commands', 'ids', 'types', 'fields']);
    for (const list of FUZZ_LISTS) {
      expect(list.name && list.about && list.payloads.length).toBeTruthy();
    }
  });

  it('go where they fit: a field to slip in only as a new field, and nothing else there', () => {
    const fields = FUZZ_LISTS.find(({ id }) => id === 'fields')!.payloads;
    const sql = FUZZ_LISTS.find(({ id }) => id === 'sql')!.payloads;
    const points = fuzzPoints(target()).filter(({ id }) => ['query:p0', 'json-new'].includes(id));

    expect(fields.every(payload => payload.field)).toBe(true);
    expect(payloadFits({ kind: 'json-new' }, fields[0])).toBe(true);
    expect(payloadFits({ kind: 'query' }, fields[0])).toBe(false);
    expect(payloadFits({ kind: 'json-new' }, sql[0])).toBe(false);
    expect(fuzzAttempts(points, [...sql, ...fields])).toHaveLength(sql.length + fields.length);
    expect(fuzzAttempts(points, [sql[0], fields[0]]).map(({ point, payload }) => [point.id, payload.value])).toEqual([['query:p0', "'"], ['json-new', 'role="admin"']]);
  });

  it("are the user's own, one a line: text, a typed value, or a field as name=value", () => {
    expect(customPayloads("admin\n\n{\"$gt\":\"\"}\nnull\nrole=admin\nlimit=10\n it's ")).toEqual([
      { value: 'admin' },
      { value: '{"$gt":""}', json: { $gt: '' } },
      { value: 'null', json: null },
      { value: 'role=admin', field: 'role', json: 'admin' },
      { value: 'limit=10', field: 'limit', json: 10 },
      { value: " it's " },
    ]);
  });
});

describe('judgeAttempt()', () => {
  const baseline: FuzzExchange = { statusCode: 200, body: '{"orders":[{"id":7}],"total":1}', bytes: 31, elapsed: 20 };
  const judge = (attempt: Partial<FuzzExchange>, value = "'", extra: object = {}) => judgeAttempt(baseline, { ...baseline, ...attempt }, { value, ...extra });
  const flagIds = (attempt: Partial<FuzzExchange>, value?: string, extra?: object) => judge(attempt, value, extra).map(({ id }) => id);

  it('has nothing to say about the same answer', () => {
    expect(judge({})).toEqual([]);
  });

  it('says when the server fails, and when it shows how', () => {
    expect(flagIds({ statusCode: 500, body: 'Internal Server Error', bytes: 21 })).toEqual(['server-error']);
    expect(judge({ statusCode: 500, body: "You have an error in your SQL syntax near '''", bytes: 45 }).map(({ id, notable }) => [id, notable]))
      .toEqual([['server-error', true], ['error-details', true]]);
  });

  it('says when a template was worked out', () => {
    expect(flagIds({ body: '{"name":"49"}', bytes: 13 }, '{{7*7}}')).toContain('evaluated');
    // (the value just coming back isn't that)
    expect(flagIds({ body: '{"name":"{{7*7}} 49"}', bytes: 21 }, '{{7*7}}')).not.toContain('evaluated');
  });

  it('says when a field slipped in was accepted, and when it came back', () => {
    const field = { field: 'isAdmin', json: true };

    expect(judge({ statusCode: 201, body: '{"id":9,"isAdmin":true}', bytes: 23 }, 'isAdmin=true', field)[0]).toMatchObject({ id: 'accepted', notable: true, label: 'The field came back as sent: isAdmin' });
    expect(judge({ statusCode: 201, body: '{"id":9}', bytes: 8 }, 'isAdmin=true', field)[0]).toMatchObject({ id: 'accepted', notable: false });
    expect(flagIds({ statusCode: 400, body: '{"error":"unknown field"}', bytes: 25 }, 'isAdmin=true', field)).not.toContain('accepted');
  });

  it('says when an attempt took far longer', () => {
    expect(flagIds({ elapsed: 3100 }, '1 AND SLEEP(3)')).toEqual(['slow']);
    expect(flagIds({ elapsed: 90 })).toEqual([]);
  });

  it("says when the request's own checks failed: a script's way to say what counts", () => {
    expect(judge({ failedChecks: ['no admin role in the answer'] })).toEqual([{ id: 'check-failed', label: 'Failed: no admin role in the answer', notable: true }]);
  });

  it('notes a value that came back as sent, another status, and another size, without calling them findings', () => {
    expect(judge({ body: '{"q":"<script>alert(1)</script>"}', bytes: 33 }, '<script>alert(1)</script>')).toEqual([expect.objectContaining({ id: 'reflected', notable: false })]);
    expect(judge({ statusCode: 404, body: '{}', bytes: 2 })).toEqual([expect.objectContaining({ id: 'status', notable: false, label: '404 where the request itself got 200' })]);
    expect(judge({ body: 'x'.repeat(90), bytes: 90 })).toEqual([expect.objectContaining({ id: 'size', notable: false })]);
  });

  it('says when nothing came back', () => {
    expect(judge({ statusCode: 0, body: '', bytes: 0, error: 'Empty reply from server' })).toEqual([{ id: 'no-answer', label: 'No answer: Empty reply from server', notable: true }]);
  });
});
