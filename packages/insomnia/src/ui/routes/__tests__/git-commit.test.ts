import { beforeEach, describe, expect, it } from '@jest/globals';
import { ActionFunctionArgs } from 'react-router-dom';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { DEFAULT_PROJECT_ID } from '../../../models/project';
import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INTERNAL_DIR } from '../../../sync/git/git-vcs';
import { MemClient } from '../../../sync/git/mem-client';
import { NeDBClient } from '../../../sync/git/ne-db-client';
import { routableFSClient } from '../../../sync/git/routable-fs-client';
import { commitToGitRepoAction } from '../git-actions';

const WORKSPACE = '.insomnium/Workspace/wrk_1.yml';
const REQUEST = '.insomnium/Request/req_1.yml';

const commit = (fields: [string, string][]) => {
  const formData = new FormData();
  fields.forEach(([name, value]) => formData.append(name, value));
  return commitToGitRepoAction({
    request: { formData: async () => formData },
    params: { workspaceId: 'wrk_1' },
  } as unknown as ActionFunctionArgs);
};

const commits = async () => (await GitVCS.log()).map(({ commit }) => commit.message.trim());

describe('Commit Changes', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.workspace.create({ _id: 'wrk_1', parentId: DEFAULT_PROJECT_ID });
    await models.request.create({ _id: 'req_1', parentId: 'wrk_1' });
    const repo = await models.gitRepository.create({ uri: '' });
    await models.workspaceMeta.update(await models.workspaceMeta.getOrCreateByParentId('wrk_1'), { gitRepositoryId: repo._id });

    await GitVCS.init({
      uri: '',
      repoId: repo._id,
      directory: GIT_CLONE_DIR,
      fs: routableFSClient(MemClient.createClient(), {
        [GIT_INSOMNIA_DIR]: NeDBClient.createClient('wrk_1', DEFAULT_PROJECT_ID),
        [GIT_INTERNAL_DIR]: MemClient.createClient(),
      }),
      gitDirectory: GIT_INTERNAL_DIR,
    });
    await GitVCS.setAuthor('a', 'a@example.com');
    await GitVCS.add(WORKSPACE);
    await GitVCS.commit('one');
  });

  it('refuses a message of only spaces', async () => {
    expect(await commit([['message', '   '], ['paths', REQUEST]])).toEqual({ errors: ['Enter a commit message.'] });
    expect(await commits()).toEqual(['one']);
  });

  it('refuses to commit when no change is chosen', async () => {
    expect(await commit([['message', 'empty']])).toEqual({ errors: ['Choose the changes to commit.'] });
    expect(await commits()).toEqual(['one']);
  });

  it('commits the chosen changes', async () => {
    expect(await commit([['message', 'add request'], ['paths', REQUEST]])).toEqual({});
    expect(await commits()).toEqual(['add request', 'one']);
  });
});
