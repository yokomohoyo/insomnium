import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import type { RequestGroup } from '../../models/request-group';
import { inheritedAuthFolder, inheritedHeaders, withFolderSettings } from '../folder-inheritance';
import { getRenderedRequestAndContext } from '../render';

const folder = (name: string, fields: Partial<RequestGroup> = {}) => ({ _id: `fld_${name}`, type: 'RequestGroup', name, ...fields }) as RequestGroup;
const workspace = { _id: 'wrk_1', type: 'Workspace', name: 'API' } as any;
const bearer = (token: string) => [{ type: 'bearer', token }];

describe('withFolderSettings()', () => {
  // ancestors are nearest first, as db.withAncestors gives them
  const inner = folder('Admin', { headers: [{ name: 'X-Scope', value: 'admin' }, { name: 'X-Off', value: 'no', disabled: true }] });
  const outer = folder('Users', { headers: [{ name: 'x-scope', value: 'users' }, { name: 'X-Client', value: 'insomnium' }], authentication: bearer('outer') });

  it("puts the folders' headers under the request's own, the nearest folder's winning", () => {
    const request = { headers: [{ name: 'X-Client', value: 'mine' }, { name: 'Accept', value: '*/*', disabled: true }], authentication: [] };
    expect(withFolderSettings(request, [inner, outer, workspace]).headers).toEqual([
      { name: 'X-Scope', value: 'admin' },
      { name: 'X-Client', value: 'mine' },
      { name: 'Accept', value: '*/*', disabled: true },
    ]);
    expect(inheritedHeaders([inner, outer]).map(({ name, folder }) => `${name} from ${folder}`)).toEqual(['X-Client from Users', 'X-Scope from Admin']);
  });

  it("gives a request with no auth the nearest folder's, and leaves one with its own", () => {
    const withInner = folder('Admin', { authentication: bearer('inner') });
    expect(withFolderSettings({ headers: [], authentication: [] }, [inner, outer]).authentication).toEqual(bearer('outer'));
    expect(withFolderSettings({ headers: [], authentication: {} as any }, [withInner, outer]).authentication).toEqual(bearer('inner'));
    expect(withFolderSettings({ headers: [], authentication: bearer('mine') }, [withInner, outer]).authentication).toEqual(bearer('mine'));
    // "No auth" is a strategy of its own, so it doesn't inherit
    expect(withFolderSettings({ headers: [], authentication: [{ type: 'none' }] }, [withInner]).authentication).toEqual([{ type: 'none' }]);
    expect(inheritedAuthFolder([inner, outer])?.name).toBe('Users');
  });

  it('leaves a request outside any folder as it is', () => {
    const request = { headers: [], authentication: [] };
    expect(withFolderSettings(request, [workspace])).toBe(request);
  });
});

describe('rendering a request in folders', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
  });

  it('sends what its folders give it, rendered with the environment', async () => {
    const wrk = await models.workspace.create({ name: 'API' });
    const base = await models.environment.getOrCreateForParentId(wrk._id);
    await models.environment.update(base, { data: { token: 't0ken', team: 'core' } });
    const users = await models.requestGroup.create({
      parentId: wrk._id,
      name: 'Users',
      authentication: [{ type: 'bearer', token: '{{ token }}' }],
      headers: [{ name: 'X-Team', value: '{{ team }}' }],
    });
    const request = await models.request.create({ parentId: users._id, url: 'http://localhost/', headers: [{ name: 'Accept', value: 'application/json' }] });

    // kept on the folder, which a folder without them doesn't get
    expect(await models.requestGroup.getById(users._id)).toMatchObject({ headers: [{ name: 'X-Team', value: '{{ team }}' }] });
    expect(Object.keys(await models.requestGroup.create({ parentId: wrk._id }))).not.toContain('headers');

    const { request: rendered } = await getRenderedRequestAndContext({ request });
    expect(rendered.headers).toEqual([{ name: 'X-Team', value: 'core' }, { name: 'Accept', value: 'application/json' }]);
    expect(rendered.authentication).toEqual([{ type: 'bearer', token: 't0ken' }]);
    // the request itself is unchanged
    expect((await models.request.getById(request._id))?.authentication).toEqual([]);
  });
});
