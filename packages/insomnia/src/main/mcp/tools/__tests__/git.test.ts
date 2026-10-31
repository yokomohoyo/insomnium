import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import electron from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import * as models from '../../../../models';
import { openWorkspaceGit } from '../../../../sync/git/workspace-git';
import { type GitActionRequest, registerGitTools } from '../git';

window.app = electron.app;

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const confirm = jest.fn<(request: GitActionRequest) => Promise<boolean>>();
let dataPath = '';
const handlers: Record<string, Handler> = {};
registerGitTools({ tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
  handlers[name] = handler;
} } as any, {
  // a repository with no remote: nothing leaves this computer
  open: workspaceId => openWorkspaceGit(workspaceId, {
    dataPath,
    http: {
      request: async () => {
        throw new Error('no network in tests');
      },
    },
  }),
  confirm,
});

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await handlers[name](args);
  return { body: JSON.parse(result.content[0].text), isError: !!result.isError };
};

describe('the Git tools', () => {
  let workspaceId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    confirm.mockReset();
    dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-git-'));
    const workspace = await models.workspace.create({ name: 'Shop', scope: 'collection' });
    workspaceId = workspace._id;
    await models.request.create({ parentId: workspaceId, name: 'List orders', url: 'https://shop.example.com/orders' });
    const repo = await models.gitRepository.create({ uri: '', author: { name: 'Pat', email: 'pat@example.com' }, credentials: null, needsFullClone: false });
    await models.workspaceMeta.update(await models.workspaceMeta.getOrCreateByParentId(workspaceId), { gitRepositoryId: repo._id });
  });

  it('status lists what changed, and commit asks first: a no changes nothing', async () => {
    const status = (await call('git_status', { workspaceId })).body;
    expect(status).toMatchObject({ branch: expect.any(String), remote: null });
    expect(status.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Shop', type: 'Workspace', status: expect.stringContaining('added') }),
      expect.objectContaining({ name: 'List orders', type: 'Request' }),
    ]));

    confirm.mockResolvedValue(false);
    expect(await call('git_commit', { workspaceId, message: 'First' })).toEqual({ body: { error: 'the user declined the commit' }, isError: true });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ action: 'commit', workspace: 'Shop', details: expect.arrayContaining(['"First"']) }));
    expect((await call('git_log', { workspaceId, depth: 20 })).body).toEqual([]);
  });

  it('commits once allowed, and the log shows it', async () => {
    confirm.mockResolvedValue(true);
    const committed = await call('git_commit', { workspaceId, message: 'First' });
    expect(committed.isError).toBe(false);
    expect(committed.body).toMatchObject({ ok: true, oid: expect.stringMatching(/^[0-9a-f]{40}$/), committed: expect.any(Number) });
    expect((await call('git_log', { workspaceId, depth: 20 })).body).toEqual([expect.objectContaining({ oid: committed.body.oid, message: 'First', author: 'Pat' })]);
    expect((await call('git_status', { workspaceId })).body.changes).toEqual([]);
    expect(await call('git_commit', { workspaceId, message: 'Again' })).toEqual({ body: { error: 'there is nothing to commit' }, isError: true });
  });

  it('pull and push need a remote, and say so without asking', async () => {
    expect(await call('git_pull', { workspaceId, rebase: false })).toEqual({ body: { error: 'the repository has no remote' }, isError: true });
    expect(await call('git_push', { workspaceId })).toEqual({ body: { error: 'the repository has no remote' }, isError: true });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('refuse a workspace that is not synced with Git', async () => {
    const plain = (await models.workspace.create({ name: 'Plain' }))._id;
    expect(await call('git_status', { workspaceId: plain })).toEqual({ body: { error: 'the workspace is not linked to a Git repository' }, isError: true });
    expect(await call('git_status', { workspaceId: 'wrk_nope' })).toEqual({ body: { error: 'workspace not found' }, isError: true });
  });
});
