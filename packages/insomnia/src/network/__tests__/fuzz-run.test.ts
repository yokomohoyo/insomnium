import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import electron from 'electron';
import fs from 'fs';

import { globalBeforeEach } from '../../__jest__/before-each';
import { FUZZ_LISTS } from '../../common/fuzz';
import * as models from '../../models';
import { listFuzzPoints, runFuzz } from '../fuzz-run';

window.app = electron.app;

const SQL = FUZZ_LISTS.find(({ id }) => id === 'sql')!.payloads.slice(0, 2);
const FIELDS = FUZZ_LISTS.find(({ id }) => id === 'fields')!.payloads.slice(0, 1);

// the mocked libcurl answers 200 to everything, with what it was given as the body
const wire = (snippet: string): { URL: string; HTTPHEADER: string[]; POSTFIELDS?: string } => JSON.parse(snippet).options;

describe('fuzzing a request', () => {
  let workspaceId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    workspaceId = (await models.workspace.create({ name: 'Shop' }))._id;
    const base = await models.environment.getOrCreateForParentId(workspaceId);
    await models.environment.update(base, { data: { host: 'localhost' } });
  });

  const request = (patch: object = {}) => models.request.create({
    parentId: workspaceId,
    name: 'Orders',
    url: 'http://{{ _.host }}/orders/7',
    parameters: [{ name: 'status', value: 'open' }],
    headers: [{ name: 'X-Tenant', value: 'acme' }],
    ...patch,
  });

  it('lists the positions of the request as it would be sent', async () => {
    const { _id } = await request();

    const { points, method, url } = await listFuzzPoints(_id);

    expect(method).toBe('GET');
    expect(url).toBe('http://localhost/orders/7');
    expect(points.map(({ id }) => id)).toEqual(['query:p0', 'path:1', 'path:2', 'header:0']);
  });

  it('sends the request as it is, then each position with each payload, one at a time', async () => {
    const { _id } = await request();
    const onAttempt = jest.fn();

    const summary = await runFuzz(_id, { pointIds: ['query:p0', 'path:2'], payloads: SQL, onAttempt });

    expect(summary.requests).toBe(5);
    expect(summary.baseline.statusCode).toBe(200);
    expect(summary.attempts.map(({ index, position, payload }) => [index, position, payload])).toEqual([
      [1, 'Query: status', "'"],
      [2, 'Query: status', '"'],
      [3, 'Path: 2nd part (7)', "'"],
      [4, 'Path: 2nd part (7)', '"'],
    ]);
    // (a quote goes as it is in a query, and encoded in a path)
    expect(wire(summary.attempts[0].snippet).URL).toBe("http://localhost/orders/7?status='");
    expect(wire(summary.attempts[2].snippet).URL).toBe('http://localhost/orders/%27?status=open');
    expect(onAttempt).toHaveBeenCalledTimes(4);
    expect(summary.stopped).toBe(false);
  });

  it('puts a payload in a header, and a field into a JSON body', async () => {
    const { _id } = await request({ method: 'POST', body: { mimeType: 'application/json', text: '{"name":"Ana"}' } });

    const summary = await runFuzz(_id, { pointIds: ['header:0', 'json-new'], payloads: [SQL[0], ...FIELDS] });

    expect(summary.attempts.map(({ position, payload }) => [position, payload])).toEqual([['Header: X-Tenant', "'"], ['Body: a new field', 'role="admin"']]);
    expect(wire(summary.attempts[0].snippet).HTTPHEADER).toContain("X-Tenant: '");
    expect(JSON.parse(wire(summary.attempts[1].snippet).POSTFIELDS!)).toEqual({ name: 'Ana', role: 'admin' });
    // (the mocked answer echoes the field back: the sign of a field that was taken)
    expect(summary.attempts[1].flags.map(({ id }) => id)).toContain('accepted');
  });

  it("runs the request's scripts for every attempt, and tells them what's being tried", async () => {
    const { _id } = await request({
      preRequestScript: "insomnia.request.headers.add({ key: 'X-Fuzz', value: insomnia.iterationData.get('fuzzAttempt') + ':' + insomnia.iterationData.get('fuzzPosition') + ':' + insomnia.iterationData.get('fuzzPayload') });",
      afterResponseScript: "insomnia.test('no quote reaches the query', () => insomnia.expect(insomnia.response.json().options.URL).to.not.include(String.fromCharCode(39)));",
    });

    const summary = await runFuzz(_id, { pointIds: ['query:p0'], payloads: SQL });

    expect(wire(summary.attempts[0].snippet).HTTPHEADER).toContain("X-Fuzz: 1:Query: status:'");
    expect(wire(summary.attempts[1].snippet).HTTPHEADER).toContain('X-Fuzz: 2:Query: status:"');
    // the script's failed test is what marks the attempt
    expect(summary.attempts[0]).toMatchObject({ notable: true, flags: [expect.objectContaining({ id: 'check-failed', label: expect.stringContaining('Failed: no quote reaches the query') })] });
    expect(summary.attempts[1].notable).toBe(false);
    expect(summary.notable).toBe(1);
  });

  it('keeps nothing of what it sends', async () => {
    const { _id } = await request();
    const responsesDir = `${process.env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData')}/responses`;
    await runFuzz(_id, { pointIds: ['query:p0'], payloads: SQL.slice(0, 1) });
    const before = fs.readdirSync(responsesDir);
    const jar = await models.cookieJar.getOrCreateForParentId(workspaceId);

    await runFuzz(_id, { pointIds: ['query:p0'], payloads: SQL });

    expect(await models.response.all()).toEqual([]);
    expect(fs.readdirSync(responsesDir)).toEqual(before);
    expect((await models.cookieJar.getById(jar._id))?.cookies).toEqual(jar.cookies);
  });

  it('waits between attempts when asked to, and stops when told', async () => {
    const { _id } = await request();
    const controller = new AbortController();

    const summary = await runFuzz(_id, {
      pointIds: ['query:p0'],
      payloads: FUZZ_LISTS.find(({ id }) => id === 'sql')!.payloads,
      delay: 1,
      signal: controller.signal,
      onAttempt: attempt => attempt.index === 2 && controller.abort(),
    });

    expect(summary.attempts).toHaveLength(2);
    expect(summary.stopped).toBe(true);
  });

  it("checks each URL with the caller's guard", async () => {
    const { _id } = await request();
    const checkUrl = jest.fn();

    await runFuzz(_id, { pointIds: ['path:2'], payloads: SQL.slice(0, 1), checkUrl });

    expect(checkUrl.mock.calls.map(([url]) => url)).toEqual(['http://localhost/orders/7?status=open', 'http://localhost/orders/%27?status=open']);
  });

  it('only fuzzes an HTTP request', async () => {
    await expect(runFuzz('req_missing', { pointIds: [], payloads: [] })).rejects.toThrow();
  });
});
