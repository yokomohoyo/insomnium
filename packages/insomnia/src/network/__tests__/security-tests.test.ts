import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import electron from 'electron';
import fs from 'fs';

import { globalBeforeEach } from '../../__jest__/before-each';
import { AUTH_API_KEY, AUTH_BEARER } from '../../common/constants';
import type { ProbeVariant, SecurityTestInput } from '../../common/security-tests';
import * as models from '../../models';
import { runRequestSecurityTests } from '../security-tests';

window.app = electron.app;

// the engine is common/security-tests.ts's, tested there: here it is what the
// runner hands it, and what each variant puts on the wire
const engine = jest.fn<(input: SecurityTestInput) => Promise<unknown>>();
jest.mock('../../common/security-tests', () => ({
  ...(jest.requireActual('../../common/security-tests') as object),
  runSecurityTests: (input: SecurityTestInput) => engine(input),
}));

// what the mocked libcurl was given for a variant: it answers with its options
const sentFor = async (requestId: string, variant: ProbeVariant, options: Parameters<typeof runRequestSecurityTests>[1] = {}) => {
  let wire: { URL: string; HTTPHEADER: string[] } | undefined;
  engine.mockImplementationOnce(async ({ send }) => {
    wire = JSON.parse((await send(variant)).body).options;
    return { checks: [], findings: [], requests: 1 };
  });
  await runRequestSecurityTests(requestId, options);
  return { url: wire!.URL, headers: wire!.HTTPHEADER };
};

describe('runRequestSecurityTests()', () => {
  let workspaceId: string;
  let requestId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    engine.mockReset();
    workspaceId = (await models.workspace.create({ name: 'Shop' }))._id;
    const base = await models.environment.getOrCreateForParentId(workspaceId);
    await models.environment.update(base, { data: { token: 'ana-token', user: 'ana' } });
    requestId = (await models.request.create({
      parentId: workspaceId,
      name: 'Orders',
      url: 'http://localhost/users/{{ _.user }}/orders',
      parameters: [{ name: 'page', value: '2' }],
      headers: [{ name: 'X-Api-Key', value: 'k3y' }, { name: 'Accept', value: 'application/json' }],
      authentication: { type: AUTH_BEARER, token: '{{ _.token }}' },
    }))._id;
  });

  it('gives the engine the request as it would be sent, without what its auth adds to the URL', async () => {
    engine.mockResolvedValue({ checks: [], findings: [], requests: 0 });

    await runRequestSecurityTests(requestId);
    expect(engine).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'GET', url: 'http://localhost/users/ana/orders?page=2', credentialInQuery: false, hasOther: false }));

    const keyed = await models.request.create({ parentId: workspaceId, url: 'http://localhost/orders', authentication: { type: AUTH_API_KEY, key: 'api_key', value: 's3cret', addTo: 'queryParams' } });
    await runRequestSecurityTests(keyed._id);
    expect(engine).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'http://localhost/orders', credentialInQuery: true }));
  });

  it('sends the request as it is', async () => {
    const { url, headers } = await sentFor(requestId, {});

    expect(url).toBe('http://localhost/users/ana/orders?page=2');
    expect(headers).toEqual(expect.arrayContaining(['X-Api-Key: k3y', 'Accept: application/json', 'Authorization: Bearer ana-token']));
  });

  it('sends it without its credentials', async () => {
    const { url, headers } = await sentFor(requestId, { url: 'http://localhost/users/ana/orders?page=2', withoutCredentials: true });

    expect(url).toBe('http://localhost/users/ana/orders?page=2');
    expect(headers).toContain('Accept: application/json');
    expect(headers.join('\n')).not.toMatch(/authorization|x-api-key|cookie/i);
  });

  it("sends a variant's Authorization in place of the auth's, and its other headers as well", async () => {
    const { headers } = await sentFor(requestId, { headers: { Authorization: 'Bearer forged', Origin: 'https://other.example' } });

    expect(headers.filter(header => /^authorization:/i.test(header))).toEqual(['Authorization: Bearer forged']);
    expect(headers).toEqual(expect.arrayContaining(['X-Api-Key: k3y', 'Origin: https://other.example']));
  });

  it("sends it as another user: their credentials, for the first user's URL", async () => {
    const base = await models.environment.getOrCreateForParentId(workspaceId);
    const other = await models.environment.create({ parentId: base._id, name: 'Ben', data: { token: 'ben-token', user: 'ben' } });

    const { url, headers } = await sentFor(requestId, { asOther: true }, { otherEnvironmentId: other._id });

    expect(url).toBe('http://localhost/users/ana/orders?page=2');
    expect(headers).toContain('Authorization: Bearer ben-token');
    expect(engine).toHaveBeenLastCalledWith(expect.objectContaining({ hasOther: true }));
  });

  it("sends it with less privilege: that environment's credentials, for the first user's URL", async () => {
    const base = await models.environment.getOrCreateForParentId(workspaceId);
    const viewer = await models.environment.create({ parentId: base._id, name: 'Viewer', data: { token: 'viewer-token', user: 'vic' } });

    const { url, headers } = await sentFor(requestId, { asLower: true }, { lowerEnvironmentId: viewer._id });

    expect(url).toBe('http://localhost/users/ana/orders?page=2');
    expect(headers).toContain('Authorization: Bearer viewer-token');
    expect(engine).toHaveBeenLastCalledWith(expect.objectContaining({ hasLower: true, hasOther: false }));
  });

  it('keeps nothing of what it sends', async () => {
    const responsesDir = `${process.env['INSOMNIA_DATA_PATH'] || electron.app.getPath('userData')}/responses`;
    // (where each answer's body and timeline are written, before they're removed)
    await sentFor(requestId, {});
    expect(fs.existsSync(responsesDir)).toBe(true);
    const before = fs.readdirSync(responsesDir);
    const jar = await models.cookieJar.getOrCreateForParentId(workspaceId);

    await sentFor(requestId, {});

    expect(await models.response.all()).toEqual([]);
    expect((await models.cookieJar.getById(jar._id))?.cookies).toEqual(jar.cookies);
    expect(fs.readdirSync(responsesDir)).toEqual(before);
  });

  it("checks each URL with the caller's guard, and sends nothing it refuses", async () => {
    const checkUrl = jest.fn((url: string) => {
      if (url.startsWith('http://169.254.')) {
        throw new Error('not allowed');
      }
    });
    engine.mockImplementationOnce(async ({ send }) => {
      await send({});
      await expect(send({ url: 'http://169.254.169.254/latest' })).rejects.toThrow('not allowed');
      return { checks: [], findings: [], requests: 2 };
    });

    await runRequestSecurityTests(requestId, { checkUrl });

    expect(checkUrl.mock.calls.map(([url]) => url)).toEqual(['http://localhost/users/ana/orders?page=2', 'http://169.254.169.254/latest']);
  });

  it('sends nothing once stopped', async () => {
    const controller = new AbortController();
    controller.abort();
    engine.mockImplementationOnce(async ({ send }) => {
      await expect(send({})).rejects.toThrow('Stopped');
      return { checks: [], findings: [], requests: 0 };
    });

    await runRequestSecurityTests(requestId, { signal: controller.signal });
    expect(engine).toHaveBeenCalledTimes(1);
  });
});
