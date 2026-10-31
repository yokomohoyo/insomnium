import type { HttpClient } from 'isomorphic-git';
import path from 'path';
import YAML from 'yaml';

import { database } from '../../common/database';
import * as models from '../../models';
import { isApiSpec } from '../../models/api-spec';
import type { GitRepository } from '../../models/git-repository';
import type { Workspace } from '../../models/workspace';
import { type DocDiff, docDiff } from './doc-diff';
import { fsClient } from './fs-client';
import { GIT_CLONE_DIR, GIT_INSOMNIA_DIR_NAME, GIT_INTERNAL_DIR, GitVCS } from './git-vcs';
import { NeDBClient } from './ne-db-client';
import parseGitPath from './parse-git-path';
import { routableFSClient } from './routable-fs-client';

// A workspace's Git repository, as the app keeps it: git's own files under the
// data folder, and the app's documents read from and written to the database.
// The window has one open at a time (GitVCS's default); an MCP client opens
// its own with this, so it never moves the window's.

export interface GitChange {
  path: string;
  type: string;
  status: string;
  staged: boolean;
  added: boolean;
  editable: boolean;
  // what changed since the last commit, by field (doc-diff.ts)
  diff?: DocDiff;
}

export interface OpenedWorkspaceGit {
  vcs: GitVCS;
  gitRepository: GitRepository;
  workspace: Workspace;
}

// the repository a workspace is linked to, opened; an error says why not
export async function openWorkspaceGit(workspaceId: string, { dataPath, http }: { dataPath: string; http: HttpClient }): Promise<OpenedWorkspaceGit> {
  const workspace = await models.workspace.getById(workspaceId);
  if (!workspace) {
    throw new Error('workspace not found');
  }
  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);
  if (!workspaceMeta?.gitRepositoryId) {
    throw new Error('the workspace is not linked to a Git repository');
  }
  const gitRepository = await models.gitRepository.getById(workspaceMeta.gitRepositoryId);
  if (!gitRepository) {
    throw new Error('Git repository not found');
  }
  if (gitRepository.needsFullClone) {
    throw new Error('the repository has not been cloned yet: open the workspace in the app first');
  }
  const baseDir = path.join(dataPath, `version-control/git/${gitRepository._id}`);
  const dataDirName = gitRepository.dataDir || GIT_INSOMNIA_DIR_NAME;
  const fs = routableFSClient(fsClient(path.join(baseDir, 'other')), {
    [path.join(GIT_CLONE_DIR, dataDirName)]: NeDBClient.createClient(workspaceId, workspace.parentId, dataDirName),
    [GIT_INTERNAL_DIR]: fsClient(baseDir),
  });
  const vcs = new GitVCS();
  await vcs.init({
    repoId: gitRepository._id,
    uri: gitRepository.uri,
    directory: GIT_CLONE_DIR,
    fs,
    gitDirectory: GIT_INTERNAL_DIR,
    gitCredentials: gitRepository.credentials,
    dataDirName,
    http,
  });
  await vcs.setAuthor(gitRepository.author.name, gitRepository.author.email);
  if (gitRepository.uri) {
    await vcs.addRemote(gitRepository.uri);
  }
  return { vcs, gitRepository, workspace };
}

async function getGitVCSPaths(vcs: GitVCS) {
  const gitFS = vcs.getFs();

  const fs = 'promises' in gitFS ? gitFS.promises : gitFS;

  const fsPaths: string[] = [];
  const dataDir = path.join(GIT_CLONE_DIR, vcs.dataDirName);
  for (const type of await fs.readdir(dataDir)) {
    const typeDir = path.join(dataDir, type);
    for (const name of await fs.readdir(typeDir)) {
      // NOTE: git paths don't start with '/' so we're omitting
      //  it here too.
      const gitPath = path.join(vcs.dataDirName, type, name);
      fsPaths.push(path.join(gitPath));
    }
  }
  // To get all possible paths, we need to combine the paths already in Git
  // with the paths on the FS. This is required to cover the case where a
  // file can be deleted from FS or from Git.
  const gitPaths = await vcs.listFiles();
  const uniquePaths = new Set([...fsPaths, ...gitPaths]);
  return Array.from(uniquePaths).sort();
}

export async function getGitChanges(vcs: GitVCS, workspace: Workspace) {
  // Cache status names
  const docs = await database.withDescendants(workspace);
  const allPaths = await getGitVCSPaths(vcs);
  const statusNames: Record<string, string> = {};
  for (const doc of docs) {
    const name = (isApiSpec(doc) && doc.fileName) || doc.name || '';
    statusNames[path.join(vcs.dataDirName, doc.type, `${doc._id}.json`)] =
      name;
    statusNames[path.join(vcs.dataDirName, doc.type, `${doc._id}.yml`)] =
      name;
  }
  // Create status items
  const items: Record<string, GitChange> = {};
  const log = (await vcs.log({ depth: 1 })) || [];

  for (const gitPath of allPaths) {
    const status = await vcs.status(gitPath);
    if (status === 'unmodified') {
      continue;
    }
    if (!statusNames[gitPath] && log.length > 0) {
      const docYML = await vcs.readObjFromTree(log[0].commit.tree, gitPath);
      if (docYML) {
        try {
          statusNames[gitPath] = YAML.parse(docYML.toString()).name || '';
        } catch (err) { }
      }
    }
    // We know that type is in the path; extract it. If the model is not found, set to Unknown.
    let { type } = parseGitPath(gitPath);

    if (type && !models.types().includes(type as any)) {
      type = 'Unknown';
    }
    const added = status.includes('added');
    let staged = !added;
    let editable = true;
    // We want to enforce that workspace changes are always committed because otherwise
    // others won't be able to clone from it. We also make fundamental migrations to the
    // scope property which need to be committed.
    // So here we're preventing people from un-staging the workspace.
    if (type === models.workspace.type) {
      editable = false;
      staged = true;
    }
    const committed = log.length > 0 ? await vcs.readObjFromTree(log[0].commit.tree, gitPath) : null;
    const current = status.includes('deleted') ? null : await vcs.readWorkingFile(gitPath);
    items[gitPath] = {
      type: type as any,
      staged,
      editable,
      status,
      added,
      path: gitPath,
      diff: docDiff(committed ? committed.toString() : null, current),
    };
  }

  return {
    changes: Object.values(items),
    statusNames,
  };
}
