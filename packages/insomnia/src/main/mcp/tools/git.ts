import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Errors } from 'isomorphic-git';
import path from 'path';
import { z } from 'zod';

import { database } from '../../../common/database';
import * as models from '../../../models';
import { GitConflictsError } from '../../../sync/git/git-vcs';
import { getGitChanges, type OpenedWorkspaceGit } from '../../../sync/git/workspace-git';
import { redactUrl } from './util';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

// What the user is asked before a client commits, pulls or pushes: each
// changes their history, or someone else's
export interface GitActionRequest {
  action: 'commit' | 'pull' | 'push';
  workspace: string;
  branch: string;
  remote: string;
  // what it would do, a line each
  details: string[];
}

export interface GitControls {
  open: (workspaceId: string) => Promise<OpenedWorkspaceGit>;
  confirm: (request: GitActionRequest) => Promise<boolean>;
}

// git keeps its own files: one operation on a repository at a time
const queues = new Map<string, Promise<unknown>>();
const oneAtATime = <T>(workspaceId: string, task: () => Promise<T>) => {
  const run = (queues.get(workspaceId) || Promise.resolve()).then(task, task);
  queues.set(workspaceId, run.catch(() => undefined));
  return run;
};

const errorText = (err: unknown) => err instanceof Errors.HttpError
  ? `${err.message}${err.data?.response ? `: ${err.data.response}` : ''}`
  : err instanceof Error ? err.message : String(err);

// The app's only: the Git a workspace syncs with, opened apart from the
// window's. Reading needs no answer; commit, pull and push ask the user.
export function registerGitTools(server: McpServer, git: GitControls) {
  const withRepo = (workspaceId: string, task: (opened: OpenedWorkspaceGit) => Promise<ReturnType<typeof text>>) =>
    oneAtATime(workspaceId, async () => {
      let opened: OpenedWorkspaceGit;
      try {
        opened = await git.open(workspaceId);
      } catch (err) {
        return text({ error: errorText(err) }, true);
      }
      try {
        return await task(opened);
      } catch (err) {
        return text({ error: errorText(err) }, true);
      }
    });

  const changesOf = async ({ vcs, workspace }: OpenedWorkspaceGit) => {
    const { changes, statusNames } = await getGitChanges(vcs, workspace);
    return changes.map(change => ({ name: statusNames[change.path] || path.basename(change.path), type: change.type, status: change.status, path: change.path }));
  };

  const ask = async (opened: OpenedWorkspaceGit, action: GitActionRequest['action'], details: string[]) => {
    const allowed = await git.confirm({
      action,
      workspace: opened.workspace.name,
      branch: await opened.vcs.getBranch(),
      remote: opened.gitRepository.uri,
      details,
    });
    console.log(`[mcp] git_${action} ${opened.workspace._id}: the user ${allowed === true ? 'allowed' : 'declined'} it`);
    return allowed === true;
  };

  server.tool(
    'git_status',
    "A Git-synced workspace's branch, its remote, and what has changed since the last commit: each changed document's name, type and status (added, modified, deleted).",
    { workspaceId: z.string() },
    async ({ workspaceId }) => withRepo(workspaceId, async opened => text({
      branch: await opened.vcs.getBranch(),
      // without a user name or token a URL may hold
      remote: opened.gitRepository.uri ? redactUrl(opened.gitRepository.uri) : null,
      changes: await changesOf(opened),
    })),
  );

  server.tool(
    'git_log',
    "A Git-synced workspace's latest commits on its branch: id, message, author and time.",
    { workspaceId: z.string(), depth: z.number().int().min(1).max(100).default(20) },
    async ({ workspaceId, depth }) => withRepo(workspaceId, async ({ vcs }) => text((await vcs.log({ depth })).map(entry => ({
      oid: entry.oid,
      message: entry.commit.message.trim(),
      author: entry.commit.author.name,
      time: new Date(entry.commit.author.timestamp * 1000).toISOString(),
    })))),
  );

  server.tool(
    'git_commit',
    "Commit a Git-synced workspace's changes (all of them, or the paths given, as git_status lists them) with a message. The app asks the user first; a declined commit returns an error and changes nothing.",
    { workspaceId: z.string(), message: z.string().trim().min(1), paths: z.array(z.string()).optional() },
    async ({ workspaceId, message, paths }) => withRepo(workspaceId, async opened => {
      const { changes } = await getGitChanges(opened.vcs, opened.workspace);
      const chosen = paths ? changes.filter(change => paths.includes(change.path)) : changes;
      if (!chosen.length) {
        return text({ error: paths ? 'none of those paths have changes' : 'there is nothing to commit' }, true);
      }
      const names = (await changesOf(opened)).filter(change => chosen.some(item => item.path === change.path));
      // the client's words, on one line, so they can't pass for the app's
      const shown = message.replace(/\s+/g, ' ').slice(0, 200);
      if (!await ask(opened, 'commit', [`Message: "${shown}${message.length > 200 ? '…' : ''}"`, '', ...names.slice(0, 10).map(change => `${change.status}: ${change.name} (${change.type})`), ...(names.length > 10 ? [`and ${names.length - 10} more`] : [])])) {
        return text({ error: 'the user declined the commit' }, true);
      }
      // what was asked about, and nothing that changed while the user decided
      const now = (await getGitChanges(opened.vcs, opened.workspace)).changes;
      const same = (change: { path: string; status: string }) => now.some(item => item.path === change.path && item.status === change.status);
      if (!chosen.every(same)) {
        return text({ error: 'the changes moved while the user was asked: call git_commit again' }, true);
      }
      for (const change of chosen) {
        change.status.includes('deleted') ? await opened.vcs.remove(change.path) : await opened.vcs.add(change.path);
      }
      const oid = await opened.vcs.commit(message);
      return text({ ok: true, oid, committed: chosen.length });
    }),
  );

  server.tool(
    'git_pull',
    "Pull a Git-synced workspace's branch from its remote (merging, or rebasing with rebase: true). The app asks the user first. Conflicting changes aren't resolved here: the result lists them, to settle in the app.",
    { workspaceId: z.string(), rebase: z.boolean().default(false) },
    async ({ workspaceId, rebase }) => withRepo(workspaceId, async opened => {
      if (!opened.gitRepository.uri) {
        return text({ error: 'the repository has no remote' }, true);
      }
      if (!await ask(opened, 'pull', [`${rebase ? 'Rebase onto' : 'Merge in'} what the remote has, changing this computer's copy of "${opened.workspace.name}".`])) {
        return text({ error: 'the user declined the pull' }, true);
      }
      const bufferId = await database.bufferChanges();
      try {
        await opened.vcs.pull(opened.gitRepository.credentials, {}, rebase);
      } catch (err) {
        if (err instanceof GitConflictsError) {
          return text({ error: err.message, conflicts: err.conflicts.map(conflict => ({ name: conflict.name, file: conflict.file })) }, true);
        }
        throw err;
      } finally {
        await database.flushChanges(bufferId);
      }
      const meta = await models.workspaceMeta.getByParentId(workspaceId);
      const [latest] = await opened.vcs.log({ depth: 1 });
      if (meta && latest) {
        await models.workspaceMeta.update(meta, { cachedGitLastCommitTime: latest.commit.author.timestamp * 1000, cachedGitLastAuthor: latest.commit.author.name });
      }
      return text({ ok: true, head: latest?.oid });
    }),
  );

  server.tool(
    'git_push',
    "Push a Git-synced workspace's branch to its remote. The app asks the user first. A push the remote refuses (it has commits this branch doesn't) says so: pull first.",
    { workspaceId: z.string() },
    async ({ workspaceId }) => withRepo(workspaceId, async opened => {
      if (!opened.gitRepository.uri) {
        return text({ error: 'the repository has no remote' }, true);
      }
      if (!await opened.vcs.canPush(opened.gitRepository.credentials)) {
        return text({ error: 'nothing to push' }, true);
      }
      const [latest] = await opened.vcs.log({ depth: 1 });
      if (!await ask(opened, 'push', [`Send this branch's commits to ${opened.gitRepository.uri}.`, ...(latest ? ['', `Latest: ${latest.commit.message.trim().split('\n')[0]}`] : [])])) {
        return text({ error: 'the user declined the push' }, true);
      }
      try {
        await opened.vcs.push(opened.gitRepository.credentials);
      } catch (err) {
        if (err instanceof Errors.PushRejectedError) {
          return text({ error: `the remote has commits this branch doesn't have: pull first (${err.message})` }, true);
        }
        throw err;
      }
      return text({ ok: true });
    }),
  );
}
