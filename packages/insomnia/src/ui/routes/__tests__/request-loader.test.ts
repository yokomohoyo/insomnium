import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../../__jest__/before-each';
import { database } from '../../../common/database';
import * as models from '../../../models';
import { loader } from '../request';

describe('the request loader', () => {
  beforeEach(globalBeforeEach);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const setUp = async () => {
    const workspace = await models.workspace.create({ name: 'Workspace' });
    await models.workspaceMeta.getOrCreateByParentId(workspace._id);
    const a = await models.request.create({ parentId: workspace._id, name: 'A' });
    const b = await models.request.create({ parentId: workspace._id, name: 'B' });
    const load = (requestId: string) => loader({ params: { organizationId: 'org', projectId: 'proj', workspaceId: workspace._id, requestId } } as any);
    const lastActive = async (requestId: string) => (await models.requestMeta.getByParentId(requestId))?.lastActive;
    return { workspace, a, b, load, lastActive };
  };

  it('writes nothing when it loads the open request again (every save revalidates it)', async () => {
    const { workspace, a, load } = await setUp();
    await load(a._id);
    expect((await models.workspaceMeta.getByParentId(workspace._id))?.activeRequestId).toBe(a._id);
    const writes = [jest.spyOn(database, 'update'), jest.spyOn(database, 'insert'), jest.spyOn(database, 'upsert')];

    await load(a._id);
    await load(a._id);

    expect(writes.flatMap(write => write.mock.calls)).toEqual([]);
  });

  it('keeps the recent order: a request opened again is the most recent, and one still open is touched once a minute', async () => {
    const { a, b, load, lastActive } = await setUp();
    let now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await load(a._id);
    now += 1000;
    await load(b._id);
    now += 1000;
    await load(a._id);
    expect(await lastActive(a._id)).toBeGreaterThan((await lastActive(b._id))!);

    const opened = await lastActive(a._id);
    now += 30_000;
    await load(a._id);
    expect(await lastActive(a._id)).toBe(opened);
    now += 31_000;
    await load(a._id);
    expect(await lastActive(a._id)).toBe(now);
  });
});
