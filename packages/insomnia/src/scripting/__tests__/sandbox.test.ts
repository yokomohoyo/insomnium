import { describe, expect, it } from '@jest/globals';

import { runInSandbox } from '../sandbox';

const request = {
  id: 'req_1',
  name: 'Get user',
  url: 'https://api.example.com/users/1',
  method: 'GET',
  headers: [{ name: 'Accept', value: 'application/json' }, { name: 'X-Old', value: 'yes' }],
  parameters: [{ name: 'expand', value: 'team' }],
  body: { mimeType: 'application/json', text: '{"a":1}' },
};
const response = {
  code: 201,
  status: 'Created',
  headers: [{ name: 'Content-Type', value: 'application/json' }],
  body: '{"id":7,"name":"Tom","tags":["a","b"]}',
  responseTime: 12,
};
const input = (overrides: object = {}) => ({
  event: 'prerequest',
  request: JSON.parse(JSON.stringify(request)),
  environment: { host: 'api.example.com', count: 1 },
  baseEnvironment: { base: 'yes' },
  environmentIsBase: false,
  variables: {},
  iterationData: { row: 'one' },
  tests: [],
  ...overrides,
});
const run = (code: string, overrides: object = {}) => runInSandbox<any>(code, input(overrides));

describe('runInSandbox()', () => {
  it('hands back what the script changed, as data', async () => {
    const { output, logs, error } = await run(`
      insomnia.environment.set('token', 'abc');
      insomnia.environment.set('count', insomnia.environment.get('count') + 1);
      insomnia.environment.unset('host');
      insomnia.baseEnvironment.set('shared', { deep: [1, 2] });
      insomnia.variables.set('local', 'just this send');
      console.log('hello', { n: 1 });
      console.warn('careful');
    `);
    expect(error).toBeUndefined();
    expect(output.environment).toEqual({ count: 2, token: 'abc' });
    expect(output.baseEnvironment).toEqual({ base: 'yes', shared: { deep: [1, 2] } });
    expect(output.variables).toEqual({ local: 'just this send' });
    expect(logs).toEqual([{ level: 'log', message: 'hello {"n":1}' }, { level: 'warn', message: 'careful' }]);
  });

  it('shares one store when the environment is the base one', async () => {
    const { output } = await run("insomnia.environment.set('a', 1); insomnia.collectionVariables.set('b', 2);", { environmentIsBase: true, baseEnvironment: {} });
    expect(output.environment).toEqual({ host: 'api.example.com', count: 1, a: 1, b: 2 });
  });

  it('resolves variables across the scopes, the request\'s own first', async () => {
    const { output } = await run(`
      insomnia.variables.set('host', 'local.example.com');
      insomnia.environment.set('seen', [insomnia.variables.get('host'), insomnia.variables.get('row'), insomnia.variables.get('base'), insomnia.variables.get('none') === undefined]);
      insomnia.environment.set('replaced', pm.variables.replaceIn('https://{{host}}/{{ row }}/{{missing}}'));
    `);
    expect(output.environment.seen).toEqual(['local.example.com', 'one', 'yes', true]);
    expect(output.environment.replaced).toBe('https://local.example.com/one/{{missing}}');
  });

  it('lets a pre-request script change the request', async () => {
    const { output } = await run(`
      insomnia.request.url = 'https://api.example.com/users/1/profile?expand=team';
      insomnia.request.method = 'post';
      insomnia.request.headers.upsert({ key: 'accept', value: 'text/plain' });
      insomnia.request.headers.add({ key: 'X-New', value: 'ok' });
      insomnia.request.headers.remove('X-Old');
      pm.request.url.addQueryParams(['page=2']);
      pm.request.body.raw = JSON.stringify({ a: 2 });
      insomnia.environment.set('url', insomnia.request.url.toString());
      insomnia.environment.set('host', pm.request.url.getHost());
    `);
    expect(output.request).toMatchObject({
      url: 'https://api.example.com/users/1/profile',
      method: 'POST',
      headers: [{ name: 'Accept', value: 'text/plain' }, { name: 'X-New', value: 'ok' }],
      parameters: [{ name: 'expand', value: 'team' }, { name: 'page', value: '2' }],
      body: { text: '{"a":2}' },
    });
    expect(output.environment.url).toBe('https://api.example.com/users/1/profile?expand=team&page=2');
    expect(output.environment.host).toBe('api.example.com');
  });

  it('runs tests on the response, with expect and Postman\'s checks', async () => {
    const { output } = await run(`
      insomnia.test('created', () => insomnia.expect(insomnia.response.code).to.equal(201));
      insomnia.test('has a name', () => pm.expect(pm.response.json()).to.have.property('name', 'Tom'));
      pm.test('tagged', () => pm.expect(pm.response.json().tags).to.include('b').and.to.have.lengthOf(2));
      pm.test('json', () => { pm.response.to.have.status(201); pm.response.to.be.success; pm.response.to.have.header('content-type'); });
      pm.test('fails', () => pm.expect(pm.response.code, 'the code').to.not.equal(201));
      pm.test('is fast', () => pm.expect(pm.response.responseTime).to.be.below(100));
      pm.test('wrong status', () => pm.response.to.have.status(404));
      pm.test('deep', () => pm.expect({ a: [1, { b: 2 }] }).to.eql({ a: [1, { b: 2 }] }));
      pm.test('async', async () => { await null; pm.expect([1, 2]).to.be.an('array'); });
      pm.test('async fails', async () => { await null; throw new Error('later'); });
      insomnia.environment.set('id', insomnia.response.json().id);
    `, { event: 'test', response });
    expect(output.tests).toEqual([
      { name: 'created', passed: true },
      { name: 'has a name', passed: true },
      { name: 'tagged', passed: true },
      { name: 'json', passed: true },
      { name: 'fails', passed: false, error: 'the code: expected 201 not to equal 201' },
      { name: 'is fast', passed: true },
      { name: 'wrong status', passed: false, error: 'expected response to have status code 404 but got 201' },
      { name: 'deep', passed: true },
      { name: 'async', passed: true },
      { name: 'async fails', passed: false, error: 'later' },
    ]);
    expect(output.environment.id).toBe(7);
  });

  it("doesn't let an after-response script change the request it sent", async () => {
    const { error } = await run("insomnia.request.url = 'https://elsewhere.example.com';", { event: 'test', response });
    expect(error).toMatch(/TypeError: The request can only be changed before it is sent/);
  });

  it('reports what a script threw, with its line', async () => {
    const { error, logs } = await run("console.log('first');\nnotDefined();");
    expect(error).toBe("ReferenceError: 'notDefined' is not defined (line 2)");
    expect(logs).toEqual([{ level: 'log', message: 'first' }]);
    expect((await run('this is not javascript')).error).toMatch(/^SyntaxError/);
  });

  it('stops a script that runs too long, and gives it nothing of the host', async () => {
    expect((await runInSandbox('while (true) {}', input(), { timeoutMs: 200 })).error).toBe('It ran for more than 0.2 seconds');
    const { output } = await run("insomnia.environment.set('reach', [typeof require, typeof process, typeof fetch, typeof window, typeof setTimeout]);");
    expect(output.environment.reach).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
  });
});
