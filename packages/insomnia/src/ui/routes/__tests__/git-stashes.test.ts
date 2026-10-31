import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import path from 'path';
import { LoaderFunctionArgs } from 'react-router-dom';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INTERNAL_DIR } from '../../../sync/git/git-vcs';
import { MemClient } from '../../../sync/git/mem-client';
import { NeDBClient } from '../../../sync/git/ne-db-client';
import { routableFSClient } from '../../../sync/git/routable-fs-client';
import { GitStashesLoaderData, gitStashesLoader } from '../git-actions';

jest.mock('path');

describe('Stashes', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.workspace.create({ _id: 'wrk_1', parentId: DEFAULT_PROJECT_ID });
    await models.request.create({ _id: 'req_1', parentId: 'wrk_1', name: 'List pets' });
    await GitVCS.init({
      uri: '',
      repoId: '',
      directory: GIT_CLONE_DIR,
      fs: routableFSClient(MemClient.createClient(), {
        [GIT_INSOMNIA_DIR]: NeDBClient.createClient('wrk_1', DEFAULT_PROJECT_ID),
        [GIT_INTERNAL_DIR]: MemClient.createClient(),
      }),
      gitDirectory: GIT_INTERNAL_DIR,
    });
    await GitVCS.setAuthor('a', 'a@example.com');
    await GitVCS.add('.insomnium/Workspace/wrk_1.yml');
    await GitVCS.add('.insomnium/Request/req_1.yml');
    await GitVCS.commit('one');
    await models.request.update((await models.request.getById('req_1'))!, { url: 'http://example.com' });
    await GitVCS.stash(['.insomnium/Request/req_1.yml'], '');
  });

  afterEach(() => (path as unknown as { __mockPath: (type: string) => void }).__mockPath('posix'));

  it.each(['posix', 'win32'])('names the requests a stash keeps, where paths are %s', async type => {
    (path as unknown as { __mockPath: (type: string) => void }).__mockPath(type);
    const { stashes, statusNames } = await gitStashesLoader({ params: { workspaceId: 'wrk_1' } } as unknown as LoaderFunctionArgs) as GitStashesLoaderData;
    expect(stashes[0].files).toEqual(['.insomnium/Request/req_1.yml']);
    expect(statusNames[stashes[0].files[0]]).toBe('List pets');
  });
});
