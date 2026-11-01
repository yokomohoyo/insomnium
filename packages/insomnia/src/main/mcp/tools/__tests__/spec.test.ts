/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import { database } from '../../../../common/database';
import { petstoreExample } from '../../../../common/petstore-example';
import * as models from '../../../../models';
import { registerSpecTools } from '../spec';

// Spectral runs on its worker thread, here from its TypeScript source
jest.mock('worker_threads', () => (jest.requireActual('../../../../__jest__/spectral-worker') as { workerThreads: unknown }).workerThreads);

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const handlers: Record<string, Handler> = {};
registerSpecTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any);

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

const WITHOUT_CONTACT = 'openapi: 3.0.3\ninfo:\n  title: Shop\n  version: 1.0.0\npaths: {}\n';
const WITHOUT_INFO = 'openapi: 3.0.3\npaths: {}\n';

describe('the spec tools', () => {
  let workspaceId: string;
  const setSpec = async (contents: string) => models.apiSpec.updateOrCreateForParentId(workspaceId, { contents });

  beforeEach(async () => {
    await globalBeforeEach();
    workspaceId = (await models.workspace.create({ name: 'Pets', scope: 'design' }))._id;
  });

  it('lint the spec with the built-in rules', async () => {
    await setSpec(WITHOUT_CONTACT);
    const { body, isError } = await call('lint_spec', { workspaceId });
    expect(isError).toBe(false);
    expect(body).toMatchObject({ ruleset: 'built-in', errors: 0 });
    expect(body.problems).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'info-contact', line: 2, path: 'info' }));

    await setSpec(WITHOUT_INFO);
    expect((await call('lint_spec', { workspaceId })).body.errors).toBeGreaterThan(0);
  });

  it("refuse a collection's or an empty spec", async () => {
    expect(await call('lint_spec', { workspaceId })).toEqual({ body: { error: 'the spec is empty: set it with set_spec' }, isError: true });
    const collectionId = (await models.workspace.create({ name: 'Pets', scope: 'collection' }))._id;
    expect(await call('generate_requests_from_spec', { workspaceId: collectionId })).toEqual({ body: { error: 'workspaceId is not a design document' }, isError: true });
  });

  it('make requests from the spec, and update them the next time', async () => {
    await setSpec(petstoreExample);
    const first = await call('generate_requests_from_spec', { workspaceId });
    expect(first.isError).toBe(false);
    expect(first.body.added.length).toBeGreaterThan(0);
    expect(first.body.added[0]).toEqual({ id: expect.any(String), name: expect.any(String), method: expect.any(String), url: expect.any(String) });
    const requests = await database.findDescendants(workspaceId, [models.request.type]);
    expect(requests).toHaveLength(first.body.added.length);

    // not copied again
    const second = (await call('generate_requests_from_spec', { workspaceId })).body;
    expect(second).toMatchObject({ ok: true, added: [], updated: [], unchanged: first.body.added.length, notInSpec: [] });
    expect(await database.findDescendants(workspaceId, [models.request.type])).toHaveLength(requests.length);
  });

  it('refuse a spec with lint errors, or an AsyncAPI one', async () => {
    await setSpec(WITHOUT_INFO);
    const refused = await call('generate_requests_from_spec', { workspaceId });
    expect(refused.isError).toBe(true);
    expect(refused.body.error).toMatch(/^the spec has \d+ lint error\(s\): fix them first$/);
    expect(refused.body.problems.every((problem: { severity: string }) => problem.severity === 'error')).toBe(true);

    await setSpec('asyncapi: 2.6.0\ninfo:\n  title: Events\n  version: 1.0.0\nchannels: {}\n');
    expect(await call('generate_requests_from_spec', { workspaceId })).toEqual({ body: { error: 'requests are generated from OpenAPI and Swagger documents, not AsyncAPI' }, isError: true });
    expect(await database.findDescendants(workspaceId, [models.request.type])).toEqual([]);
  });
});
