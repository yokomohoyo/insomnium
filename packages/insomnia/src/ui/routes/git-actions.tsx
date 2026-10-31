import { fromUrl } from 'hosted-git-info';
import { Errors } from 'isomorphic-git';
import { env as processEnv } from 'node:process';
import path from 'path';
import { ActionFunction, LoaderFunction, redirect } from 'react-router-dom';
import YAML from 'yaml';

import { ACTIVITY_SPEC } from '../../common/constants';
import { database } from '../../common/database';
import * as models from '../../models';
import { isApiSpec } from '../../models/api-spec';
import { GitRepository } from '../../models/git-repository';
import { createGitRepository } from '../../models/helpers/git-repository-operations';
import { DEFAULT_ORGANIZATION_ID } from '../../models/organization';
import { DEFAULT_PROJECT_ID } from '../../models/project';
import {
  Workspace,
  WorkspaceScopeKeys,
} from '../../models/workspace';
import { fsClient } from '../../sync/git/fs-client';
import { gitRollback } from '../../sync/git/git-rollback';
import GitVCS, {
  GIT_CLONE_DIR,
  GIT_INSOMNIA_DIR_NAME,
  GIT_INTERNAL_DIR,
  GitConflictsError,
  GitLogEntry,
  type GitStash,
  type GitTag,
} from '../../sync/git/git-vcs';
import type { DocConflict, MergeChoice } from '../../sync/git/merge-docs';
import { MemClient } from '../../sync/git/mem-client';
import { findInsomniaProjectFiles, importInsomniaProjectFiles } from '../../sync/git/insomnia-git-project';
import { clonedDataDir, importClonedDocs, NeDBClient } from '../../sync/git/ne-db-client';
import parseGitPath from '../../sync/git/parse-git-path';
import { convertToPosixSep } from '../../sync/git/path-sep';
import { routableFSClient } from '../../sync/git/routable-fs-client';
import { shallowClone } from '../../sync/git/shallow-clone';
import { isSshUrl } from '../../sync/git/ssh-url';
import {
  addDotGit,
} from '../../sync/git/utils';
import { type DocDiff, docDiff } from '../../sync/git/doc-diff';
import { guard } from '../../utils/guard';

// Loaders
export type GitRepoLoaderData =
  | {
    branch: string;
    branches: string[];
    gitRepository: GitRepository | null;
  }
  | {
    errors: string[];
  };

export const gitRepoAction: ActionFunction = async ({
  params,
}): Promise<GitRepoLoaderData> => {
  try {
    const { workspaceId, projectId } = params;
    guard(typeof workspaceId === 'string', 'Workspace Id is required');
    guard(typeof projectId === 'string', 'Project Id is required');

    const workspace = await models.workspace.getById(workspaceId);
    guard(workspace, 'Workspace not found');
    const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);
    guard(workspaceMeta, 'Workspace meta not found');
    if (!workspaceMeta.gitRepositoryId) {
      return {
        errors: ['Workspace is not linked to a git repository'],
      };
    }

    const gitRepository = await models.gitRepository.getById(
      workspaceMeta.gitRepositoryId
    );
    guard(gitRepository, 'Git Repository not found');

    if (GitVCS.isInitializedForRepo(gitRepository._id)) {
      return {
        branch: await GitVCS.getBranch(),
        branches: await GitVCS.listBranches(),
        gitRepository: gitRepository,
      };
    }

    const baseDir = path.join(
      processEnv['INSOMNIA_DATA_PATH'] || window.app.getPath('userData'),
      `version-control/git/${gitRepository._id}`
    );

    // All app data is stored within a namespaced directory at the root of the repository (.insomnium, or .insomnia for a repository from Insomnia) and is read/written from the local NeDB database
    const dataDirName = gitRepository.dataDir || GIT_INSOMNIA_DIR_NAME;
    const neDbClient = NeDBClient.createClient(workspaceId, projectId, dataDirName);

    // All git metadata in the GIT_INTERNAL_DIR directory is stored in a git/ directory on the filesystem
    const gitDataClient = fsClient(baseDir);

    // All data outside the directories listed below will be stored in an 'other' directory. This is so we can support files that exist outside the ones the app is specifically in charge of.
    const otherDatClient = fsClient(path.join(baseDir, 'other'));

    // The routable FS client directs isomorphic-git to read/write from the database or from the correct directory on the file system while performing git operations.
    const routableFS = routableFSClient(otherDatClient, {
      [path.join(GIT_CLONE_DIR, dataDirName)]: neDbClient,
      [GIT_INTERNAL_DIR]: gitDataClient,
    });

    // Init VCS
    const { credentials, uri } = gitRepository;
    if (gitRepository.needsFullClone) {
      await GitVCS.initFromClone({
        repoId: gitRepository._id,
        url: uri,
        gitCredentials: credentials,
        directory: GIT_CLONE_DIR,
        fs: routableFS,
        gitDirectory: GIT_INTERNAL_DIR,
        workspaceId,
        dataDirName,
      });

      await models.gitRepository.update(gitRepository, {
        needsFullClone: false,
      });
    } else {
      await GitVCS.init({
        repoId: gitRepository._id,
        uri,
        directory: GIT_CLONE_DIR,
        fs: routableFS,
        gitDirectory: GIT_INTERNAL_DIR,
        gitCredentials: credentials,
        dataDirName,
      });
    }

    // Configure basic info
    const { author, uri: gitUri } = gitRepository;
    await GitVCS.setAuthor(author.name, author.email);
    if (gitUri) {
      await GitVCS.addRemote(gitUri);
    }

    return {
      branch: await GitVCS.getBranch(),
      branches: await GitVCS.listBranches(),
      gitRepository: gitRepository,
    };
  } catch (e) {
    console.error(e);
    const errorMessage =
      e instanceof Error ? e.message : 'Error while fetching git repository.';
    return {
      errors: [errorMessage],
    };
  }
};

export type GitBranchesLoaderData =
  | {
    branches: string[];
    remoteBranches: string[];
    // the checked-out branch, as it is now
    branch: string;
  }
  | {
    errors: string[];
  };

export const gitBranchesLoader: LoaderFunction = async ({
  params,
}): Promise<GitBranchesLoaderData> => {
  const { workspaceId, projectId } = params;
  guard(typeof workspaceId === 'string', 'Workspace Id is required');
  guard(typeof projectId === 'string', 'Project Id is required');

  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');
  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);
  guard(workspaceMeta, 'Workspace meta not found');
  if (!workspaceMeta.gitRepositoryId) {
    return {
      errors: ['Workspace is not linked to a git repository'],
    };
  }

  const gitRepository = await models.gitRepository.getById(
    workspaceMeta.gitRepositoryId
  );
  guard(gitRepository, 'Git Repository not found');

  const branches = await GitVCS.listBranches();

  const remoteBranches = await GitVCS.fetchRemoteBranches();

  return {
    branches,
    remoteBranches,
    branch: await GitVCS.getBranch(),
  };
};

export interface GitFetchLoaderData {
  errors: string[];
}

export const gitFetchAction: ActionFunction = async ({
  params,
}): Promise<GitFetchLoaderData> => {
  const { workspaceId, projectId } = params;
  guard(typeof workspaceId === 'string', 'Workspace Id is required');
  guard(typeof projectId === 'string', 'Project Id is required');

  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');
  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);
  guard(workspaceMeta, 'Workspace meta not found');
  if (!workspaceMeta.gitRepositoryId) {
    return {
      errors: ['Workspace is not linked to a git repository'],
    };
  }

  const gitRepository = await models.gitRepository.getById(
    workspaceMeta.gitRepositoryId
  );
  guard(gitRepository, 'Git Repository not found');

  try {
    await GitVCS.fetch({
      singleBranch: true,
      credentials: gitRepository.credentials,
    });
  } catch (e) {
    console.error(e);
    return {
      errors: ['Failed to fetch from remote'],
    };
  }

  return {
    errors: [],
  };
};

export type GitLogLoaderData =
  | {
    log: GitLogEntry[];
  }
  | {
    errors: string[];
  };

export const gitLogLoader: LoaderFunction = async ({
  params,
}): Promise<GitLogLoaderData> => {
  const { workspaceId, projectId } = params;
  guard(typeof workspaceId === 'string', 'Workspace Id is required');
  guard(typeof projectId === 'string', 'Project Id is required');

  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');
  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);
  guard(workspaceMeta, 'Workspace meta not found');
  if (!workspaceMeta.gitRepositoryId) {
    return {
      errors: ['Workspace is not linked to a git repository'],
    };
  }

  const gitRepository = await models.gitRepository.getById(
    workspaceMeta.gitRepositoryId
  );
  guard(gitRepository, 'Git Repository not found');
  try {
    const log = await GitVCS.log({ depth: 35 });

    return {
      log,
    };
  } catch (e) {
    console.log(e);
    return {
      log: [],
    };
  }
};

export interface GitChangesLoaderData {
  changes: GitChange[];
  branch: string;
  statusNames: Record<string, string>;
}

export const gitChangesLoader: LoaderFunction = async ({
  params,
}): Promise<GitChangesLoaderData> => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace Id is required');

  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');

  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);

  const repoId = workspaceMeta?.gitRepositoryId;

  guard(repoId, 'Workspace is not linked to a git repository');

  const gitRepository = await models.gitRepository.getById(repoId);

  guard(gitRepository, 'Git Repository not found');

  const branch = await GitVCS.getBranch();
  try {
    const { changes, statusNames } = await getGitChanges(GitVCS, workspace);

    return {
      branch,
      changes,
      statusNames,
    };
  } catch (e) {
    console.log(e);
    return {
      branch,
      changes: [],
      statusNames: {},
    };
  }
};

// Actions
type CloneGitActionResult =
  | Response
  | {
    errors?: string[];
  };

const INVALID_URI = "That isn't a repository address: use its https:// address, or an SSH one such as git@github.com:org/repo.git";

// An SSH address, connected to over SSH (main/git-ssh) unless its https:// form
// was chosen: its key settings, in place of a username and token
const overSsh = (uri: string, formData: FormData) => isSshUrl(uri) && formData.get('transport') !== 'https';
const sshCredentialsFrom = (formData: FormData) => ({
  username: '',
  password: '',
  sshKey: String(formData.get('sshKey') || '').trim(),
  sshPassphrase: String(formData.get('sshPassphrase') || ''),
});

export function parseGitToHttpsURL(s: string) {
  // try to convert any git URL to https URL
  let parsed = fromUrl(s)?.https({ noGitPlus: true }) || '';

  // fallback for self-hosted git servers, see https://github.com/Kong/insomnia/issues/5967
  // and https://github.com/npm/hosted-git-info/issues/11
  if (parsed === '') {
    let temp = s;
    // handle "shorter scp-like syntax"
    temp = temp.replace(/^git@([^:]+):/, 'https://$1/');
    // handle proper SSH URLs
    temp = temp.replace(/^ssh:\/\//, 'https://');

    // final URL fallback for any other git URL
    temp = new URL(temp).href;
    parsed = temp;
  }

  return parsed;
}

export const cloneGitRepoAction: ActionFunction = async ({
  request,
  params,
}): Promise<CloneGitActionResult> => {
  const { organizationId, projectId } = params;

  guard(typeof projectId === 'string', 'ProjectId is required.');
  const project = await models.project.getById(projectId);
  guard(project, 'Project not found');

  const repoSettingsPatch: Partial<GitRepository> = {};
  const formData = await request.formData();

  // URI
  const uri = formData.get('uri');
  guard(typeof uri === 'string', 'URI is required');
  const ssh = overSsh(uri, formData);
  try {
    repoSettingsPatch.uri = ssh ? uri.trim() : parseGitToHttpsURL(uri);
  } catch {
    return { errors: [INVALID_URI] };
  }
  // Author
  const authorName = formData.get('authorName');
  guard(typeof authorName === 'string', 'Author name is required');
  const authorEmail = formData.get('authorEmail');
  guard(typeof authorEmail === 'string', 'Author email is required');

  repoSettingsPatch.author = {
    name: authorName,
    email: authorEmail,
  };

  // Git Credentials
  if (ssh) {
    repoSettingsPatch.credentials = sshCredentialsFrom(formData);
  } else {
    const token = formData.get('token');
    guard(typeof token === 'string', 'Token is required');
    const username = formData.get('username');
    guard(typeof username === 'string', 'Username is required');

    repoSettingsPatch.credentials = {
      password: token,
      username,
    };
  }

  repoSettingsPatch.needsFullClone = true;
  repoSettingsPatch.uri = addDotGit(repoSettingsPatch.uri);
  const fsClient = MemClient.createClient();

  try {
    await shallowClone({
      fsClient,
      gitRepository: repoSettingsPatch as GitRepository,
    });
  } catch (err) {
    console.error(err);

    if (err instanceof Errors.HttpError) {
      return {
        errors: [`${err.message}, ${err.data.response}`],
      };
    }

    return {
      errors: [err.message],
    };
  }

  // a repository from Insomnia keeps its data in .insomnia, and keeps it there
  const dataDirName = await clonedDataDir(fsClient);
  if (dataDirName && dataDirName !== GIT_INSOMNIA_DIR_NAME) {
    repoSettingsPatch.dataDir = dataDirName;
  }

  // Stop the DB from pushing updates to the UI temporarily
  const bufferId = await database.bufferChanges();
  let workspaceId = '';
  let scope: 'design' | 'collection' = WorkspaceScopeKeys.design;
  // If no workspace exists we create a new one
  if (!dataDirName) {
    // a Git project of Kong Insomnia's (12.6+): its files imported, each a
    // collection or document of its own, and not linked (insomnia-git-project.ts)
    const projectFiles = await findInsomniaProjectFiles(fsClient);
    if (projectFiles.length) {
      const { workspaces, failed } = await importInsomniaProjectFiles(projectFiles, project._id);
      await database.flushChanges(bufferId);
      if (!workspaces.length) {
        return { errors: [`This is an Insomnia Git project, but none of its files imported: ${failed.map(file => `${file.path}: ${file.error}`).join('; ')}`] };
      }
      failed.forEach(file => console.warn(`[git] Didn't import ${file.path}: ${file.error}`));
      // one: open it; more: the project, where they all are
      return redirect(workspaces.length === 1
        ? `/organization/${organizationId}/project/${projectId}/workspace/${workspaces[0]._id}/${workspaces[0].scope === WorkspaceScopeKeys.collection ? 'debug' : ACTIVITY_SPEC}`
        : `/organization/${organizationId}/project/${projectId}`);
    }

    // Create a new workspace

    const workspace = await models.workspace.create({
      name: repoSettingsPatch.uri.split('/').pop(),
      scope: scope,
      parentId: project._id,
      description: `Insomnium Workspace for ${repoSettingsPatch.uri}}`,
    });
    await models.apiSpec.getOrCreateForParentId(workspace._id);

    workspaceId = workspace._id;

    // Store GitRepository settings and set it as active
    await createGitRepository(workspace._id, repoSettingsPatch);
  } else {
    // Clone all entities from the repository
    const imported = await importClonedDocs(fsClient, project._id, dataDirName);
    if ('error' in imported || 'existingWorkspace' in imported) {
      await database.flushChanges(bufferId);
    }
    if ('error' in imported) {
      return {
        errors: [imported.error],
      };
    }
    if ('existingWorkspace' in imported) {
      const { existingWorkspace } = imported;
      return redirect(`/organization/${existingWorkspace.parentId || DEFAULT_ORGANIZATION_ID}/project/${existingWorkspace.parentId || DEFAULT_PROJECT_ID}/workspace/${existingWorkspace._id}/debug`);
    }
    workspaceId = imported.workspace._id;
    scope = imported.workspace.scope;

    // Store GitRepository settings and set it as active
    await createGitRepository(workspaceId, repoSettingsPatch);
  }

  // Flush DB changes
  await database.flushChanges(bufferId);

  guard(workspaceId, 'Workspace ID is required');

  // Redirect to debug for collection scope initial clone
  if (scope === WorkspaceScopeKeys.collection) {
    return redirect(
      `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/debug`
    );
  }
  return redirect(
    `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/${ACTIVITY_SPEC}`
  );
};

export const updateGitRepoAction: ActionFunction = async ({
  request,
  params,
}) => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');
  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');

  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);
  let gitRepositoryId = workspaceMeta?.gitRepositoryId;

  const repoSettingsPatch: Partial<GitRepository> = {};
  const formData = await request.formData();

  // URI: none makes a repository on this computer only, to which a remote can
  // be added later. The field is disabled once a repository has one, so none
  // sent for an existing repository leaves its address as it is
  const uri = formData.get('uri');
  guard(typeof uri === 'string', 'URI is required');
  // a repository's address, or the one it already has
  const existing = gitRepositoryId ? await models.gitRepository.getById(gitRepositoryId) : null;
  const ssh = overSsh(uri.trim() || existing?.uri || '', formData);
  if (uri.trim()) {
    try {
      repoSettingsPatch.uri = ssh ? uri.trim() : parseGitToHttpsURL(uri.trim());
    } catch {
      return { errors: [INVALID_URI] };
    }
  }

  // Author
  const authorName = formData.get('authorName');
  guard(typeof authorName === 'string', 'Author name is required');
  const authorEmail = formData.get('authorEmail');
  guard(typeof authorEmail === 'string', 'Author email is required');

  repoSettingsPatch.author = {
    name: authorName,
    email: authorEmail,
  };

  // Git Credentials
  if (ssh) {
    repoSettingsPatch.credentials = sshCredentialsFrom(formData);
  } else {
    const token = formData.get('token');
    guard(typeof token === 'string', 'Token is required');
    const username = formData.get('username');
    guard(typeof username === 'string', 'Username is required');

    repoSettingsPatch.credentials = {
      password: token,
      username,
    };
  }

  if (gitRepositoryId) {
    const repo = await models.gitRepository.getById(gitRepositoryId);
    guard(repo, 'GitRepository not found');
    await models.gitRepository.update(repo, repoSettingsPatch);
    gitRepositoryId = repo._id;
    // a remote for a repository that had none, now rather than on the next start
    if (repoSettingsPatch.uri && GitVCS.isInitializedForRepo(repo._id)) {
      await GitVCS.addRemote(repoSettingsPatch.uri);
    }
  } else {
    // a remote is cloned from; a repository on this computer starts empty
    repoSettingsPatch.uri = repoSettingsPatch.uri || '';
    repoSettingsPatch.needsFullClone = Boolean(repoSettingsPatch.uri);
    const gitRepository = await models.gitRepository.create(repoSettingsPatch);
    gitRepositoryId = gitRepository._id;
  }

  await models.workspaceMeta.updateByParentId(workspaceId, {
    gitRepositoryId,
  });

  return null;
};

export const resetGitRepoAction: ActionFunction = async ({ params }) => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');

  const workspace = await models.workspace.getById(workspaceId);

  guard(workspace, 'Workspace not found');

  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);

  const repoId = workspaceMeta?.gitRepositoryId;

  guard(repoId, 'Workspace is not linked to a git repository');

  const repo = await models.gitRepository.getById(repoId);

  guard(repo, 'Git Repository not found');

  const flushId = await database.bufferChanges();
  if (workspaceMeta) {
    await models.workspaceMeta.update(workspaceMeta, {
      gitRepositoryId: null,
      cachedGitLastCommitTime: null,
      cachedGitRepositoryBranch: null,
      cachedGitLastAuthor: null,
    });
  }

  await models.gitRepository.remove(repo);
  await database.flushChanges(flushId);

  return null;
};

export interface CommitToGitRepoResult {
  errors?: string[];
}

export const commitToGitRepoAction: ActionFunction = async ({
  request,
  params,
}): Promise<CommitToGitRepoResult> => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');

  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');

  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);

  const repoId = workspaceMeta?.gitRepositoryId;
  guard(repoId, 'Workspace is not linked to a git repository');

  const repo = await models.gitRepository.getById(repoId);
  guard(repo, 'Git Repository not found');

  const formData = await request.formData();

  const message = formData.get('message');
  guard(typeof message === 'string', 'Commit message is required');

  const stagedChangesPaths = [...formData.getAll('paths')] as string[];
  const allModified = Boolean(formData.get('allModified'));
  const allUnversioned = Boolean(formData.get('allUnversioned'));

  try {
    const { changes } = await getGitChanges(GitVCS, workspace);

    const changesToCommit = changes.filter(change => {
      if (allModified && !change.added) {
        return true;
      } else if (allUnversioned && change.added) {
        return true;
      }
      return stagedChangesPaths.includes(change.path);
    });

    for (const item of changesToCommit) {
      item.status.includes('deleted')
        ? await GitVCS.remove(item.path)
        : await GitVCS.add(item.path);
    }

    await GitVCS.commit(message);


  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Error while committing changes';
    return { errors: [message] };
  }

  return {};
};

export interface CreateNewGitBranchResult {
  errors?: string[];
}

export const createNewGitBranchAction: ActionFunction = async ({
  request,
  params,
}): Promise<CreateNewGitBranchResult> => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');

  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');

  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);

  const repoId = workspaceMeta?.gitRepositoryId;
  guard(repoId, 'Workspace is not linked to a git repository');

  const repo = await models.gitRepository.getById(repoId);
  guard(repo, 'Git Repository not found');

  const formData = await request.formData();

  const branch = formData.get('branch');
  guard(typeof branch === 'string', 'Branch name is required');

  try {
    await GitVCS.checkout(branch);

  } catch (err) {
    if (err instanceof Errors.HttpError) {
      return {
        errors: [`${err.message}, ${err.data.response}`],
      };
    }
    const errorMessage =
      err instanceof Error
        ? err.message
        : 'Something went wrong while creating a new branch';
    return {
      errors: [errorMessage],
    };
  }
  // the new branch is checked out, as after a checkout
  if (workspaceMeta) {
    await models.workspaceMeta.update(workspaceMeta, { cachedGitRepositoryBranch: branch });
  }

  return {};
};

export interface CheckoutGitBranchResult {
  errors?: string[];
}
export const checkoutGitBranchAction: ActionFunction = async ({
  request,
  params,
}): Promise<CheckoutGitBranchResult> => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');

  const workspace = await models.workspace.getById(workspaceId);

  guard(workspace, 'Workspace not found');

  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);

  const repoId = workspaceMeta?.gitRepositoryId;

  guard(repoId, 'Workspace is not linked to a git repository');

  const repo = await models.gitRepository.getById(repoId);
  guard(repo, 'Git Repository not found');

  const formData = await request.formData();

  const branch = formData.get('branch');
  guard(typeof branch === 'string', 'Branch name is required');

  const bufferId = await database.bufferChanges();
  try {
    await GitVCS.checkout(branch);
  } catch (err) {
    await database.flushChanges(bufferId);
    if (err instanceof Errors.HttpError) {
      return {
        errors: [`${err.message}, ${err.data.response}`],
      };
    }
    const errorMessage = err instanceof Error ? err.message : err;
    return {
      errors: [errorMessage],
    };
  }

  if (workspaceMeta) {
    const log = (await GitVCS.log({ depth: 1 })) || [];

    const author = log[0] ? log[0].commit.author : null;
    const cachedGitLastCommitTime = author ? author.timestamp * 1000 : null;

    await models.workspaceMeta.update(workspaceMeta, {
      cachedGitLastCommitTime,
      cachedGitRepositoryBranch: branch,
      cachedGitLastAuthor: author?.name || null,
    });
  }

  await database.flushChanges(bufferId);

  return {};
};

export interface MergeGitBranchResult {
  errors?: string[];
  // documents both branches changed: choose, and merge again with the choices
  conflicts?: DocConflict[];
}

// the choices for a merge's conflicts, by file name, sent as JSON
const mergeChoicesFrom = (formData: FormData): Record<string, MergeChoice> => {
  const choices = formData.get('choices');
  if (typeof choices !== 'string' || !choices) {
    return {};
  }
  const parsed = JSON.parse(choices);
  return Object.fromEntries(Object.entries(parsed && typeof parsed === 'object' ? parsed : {})
    .filter((entry): entry is [string, MergeChoice] => entry[1] === 'ours' || entry[1] === 'theirs'));
};

export const mergeGitBranchAction: ActionFunction = async ({
  request,
  params,
}): Promise<MergeGitBranchResult> => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');

  const workspace = await models.workspace.getById(workspaceId);

  guard(workspace, 'Workspace not found');

  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);

  const repoId = workspaceMeta?.gitRepositoryId;

  guard(repoId, 'Workspace is not linked to a git repository');

  const repo = await models.gitRepository.getById(repoId);
  guard(repo, 'Git Repository not found');

  const formData = await request.formData();
  const branch = formData.get('branch');
  guard(typeof branch === 'string', 'Branch name is required');

  // the merge stays on the current branch, which the work tree follows
  const bufferId = await database.bufferChanges();
  try {
    await GitVCS.mergeByField(branch, mergeChoicesFrom(formData));
  } catch (err) {
    if (err instanceof GitConflictsError) {
      return { conflicts: err.conflicts };
    }
    if (err instanceof Errors.HttpError) {
      return {
        errors: [`${err.message}, ${err.data.response}`],
      };
    }
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return { errors: [errorMessage] };
  } finally {
    await database.flushChanges(bufferId, true);
  }

  return {};
};

export const rebaseGitBranchAction: ActionFunction = async ({
  request,
  params,
}): Promise<MergeGitBranchResult> => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');
  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);
  guard(workspaceMeta?.gitRepositoryId, 'Workspace is not linked to a git repository');

  const formData = await request.formData();
  const branch = formData.get('branch');
  guard(typeof branch === 'string', 'Branch name is required');

  // the current branch's commits go on top of branch's, and the work tree follows
  const bufferId = await database.bufferChanges();
  try {
    await GitVCS.rebase(branch, mergeChoicesFrom(formData));
  } catch (err) {
    if (err instanceof GitConflictsError) {
      return { conflicts: err.conflicts };
    }
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return { errors: [errorMessage] };
  } finally {
    await database.flushChanges(bufferId, true);
  }

  return {};
};

export interface DeleteGitBranchResult {
  errors?: string[];
}

export const deleteGitBranchAction: ActionFunction = async ({
  request,
  params,
}): Promise<DeleteGitBranchResult> => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');

  const workspace = await models.workspace.getById(workspaceId);

  guard(workspace, 'Workspace not found');

  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);

  const repoId = workspaceMeta?.gitRepositoryId;

  guard(repoId, 'Workspace is not linked to a git repository');

  const repo = await models.gitRepository.getById(repoId);
  guard(repo, 'Git Repository not found');

  const formData = await request.formData();

  const branch = formData.get('branch');
  guard(typeof branch === 'string', 'Branch name is required');

  try {
    await GitVCS.deleteBranch(branch);

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return { errors: [errorMessage] };
  }

  return {};
};

export interface PushToGitRemoteResult {
  errors?: string[];
  // the remote has commits this branch doesn't: pull them, or force push
  rejected?: boolean;
}

export const pushToGitRemoteAction: ActionFunction = async ({
  request,
  params,
}): Promise<PushToGitRemoteResult> => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');
  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');

  const formData = await request.formData();

  // sent as text: 'false' is no force
  const force = formData.get('force') === 'true';

  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);

  const repoId = workspaceMeta?.gitRepositoryId;

  guard(repoId, 'Workspace is not linked to a git repository');

  const gitRepository = await models.gitRepository.getById(repoId);

  guard(gitRepository, 'Git Repository not found');

  // Check if there is anything to push
  let canPush = false;
  try {
    canPush = await GitVCS.canPush(gitRepository.credentials);
  } catch (err) {
    if (err instanceof Errors.HttpError) {
      return {
        errors: [`${err.message}, ${err.data.response}`],
      };
    }
    const errorMessage = err instanceof Error ? err.message : 'Unknown Error';

    return { errors: [errorMessage] };
  }
  // If nothing to push, display that to the user
  if (!canPush) {
    return {
      errors: ['Nothing to push'],
    };
  }

  const bufferId = await database.bufferChanges();
  try {
    await GitVCS.push(gitRepository.credentials, force);

  } catch (err: unknown) {
    await database.flushChanges(bufferId);
    if (err instanceof Errors.HttpError) {
      return {
        errors: [`${err.message}, ${err.data.response}`],
      };
    }
    const errorMessage = err instanceof Error ? err.message : 'Unknown Error';

    if (err instanceof Errors.PushRejectedError) {
      return {
        errors: [`The remote has commits this branch doesn't have (${errorMessage}).`],
        rejected: true,
      };
    }

    return {
      errors: [`Error Pushing Repository, ${errorMessage}` + `\n recommendation: use git inside terminal to resolve this.`],
    };
  }

  await database.flushChanges(bufferId);

  return {};
};

export interface PullFromGitRemoteResult {
  errors?: string[];
  conflicts?: DocConflict[];
}

export const pullFromGitRemoteAction: ActionFunction = async ({
  request,
  params,
}): Promise<PullFromGitRemoteResult> => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');
  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');

  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);

  const repoId = workspaceMeta?.gitRepositoryId;

  guard(repoId, 'Workspace is not linked to a git repository');

  const gitRepository = await models.gitRepository.getById(repoId);

  guard(gitRepository, 'Git Repository not found');

  const bufferId = await database.bufferChanges();


  // the pull fetches what it merges (or rebases onto)
  const formData = await request.formData();
  try {
    await GitVCS.pull(gitRepository.credentials, mergeChoicesFrom(formData), formData.get('rebase') === 'true');
  } catch (err: unknown) {
    await database.flushChanges(bufferId);
    if (err instanceof GitConflictsError) {
      return { conflicts: err.conflicts };
    }
    if (err instanceof Errors.HttpError) {
      return { errors: [`${err.message}, ${err.data.response}`] };
    }
    const errorMessage = err instanceof Error ? err.message : 'Unknown Error';

    return {
      errors: [`${errorMessage}`],
    };
  }

  if (workspaceMeta) {
    const log = (await GitVCS.log({ depth: 1 })) || [];

    const author = log[0] ? log[0].commit.author : null;
    const cachedGitLastCommitTime = author ? author.timestamp * 1000 : null;

    await models.workspaceMeta.update(workspaceMeta, {
      cachedGitLastCommitTime,
      cachedGitLastAuthor: author?.name || null,
    });
  }

  await database.flushChanges(bufferId);

  return {};
};

export interface GitChange {
  path: string;
  type: string;
  status: string;
  staged: boolean;
  added: boolean;
  editable: boolean;
  // what changed since the last commit, by field (sync/git/doc-diff.ts)
  diff?: DocDiff;
}

async function getGitVCSPaths(vcs: typeof GitVCS) {
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

async function getGitChanges(vcs: typeof GitVCS, workspace: Workspace) {
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

export interface GitTagsLoaderData {
  tags: GitTag[];
  // the current commit, which a new tag goes on
  head: string;
  hasRemote: boolean;
  errors?: string[];
}

export const gitTagsLoader: LoaderFunction = async (): Promise<GitTagsLoaderData> => {
  try {
    const [head] = await GitVCS.log({ depth: 1 });
    return { tags: await GitVCS.listTags(), head: head?.oid || '', hasRemote: !!(await GitVCS.getRemote('origin'))?.url };
  } catch (err) {
    return { tags: [], head: '', hasRemote: false, errors: [err instanceof Error ? err.message : String(err)] };
  }
};

export interface GitTagResult {
  errors?: string[];
}

// create, push or delete a tag
export const gitTagAction: ActionFunction = async ({ request, params }): Promise<GitTagResult> => {
  const { workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');
  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);
  const gitRepository = workspaceMeta?.gitRepositoryId ? await models.gitRepository.getById(workspaceMeta.gitRepositoryId) : null;
  guard(gitRepository, 'Workspace is not linked to a git repository');

  const formData = await request.formData();
  const intent = formData.get('intent');
  const name = String(formData.get('name') || '').trim();
  guard(name, 'A tag name is required');
  try {
    if (intent === 'create') {
      await GitVCS.createTag(name, String(formData.get('message') || ''));
    } else if (intent === 'push') {
      await GitVCS.pushTag(name, gitRepository.credentials);
    } else if (intent === 'delete') {
      await GitVCS.deleteTag(name, { remote: formData.get('remote') === 'true', gitCredentials: gitRepository.credentials });
    }
  } catch (err) {
    if (err instanceof Errors.HttpError) {
      return { errors: [`${err.message}, ${err.data.response}`] };
    }
    return { errors: [err instanceof Error ? err.message : String(err)] };
  }
  return {};
};

export interface GitStashesLoaderData {
  stashes: GitStash[];
  // what a stash now would keep aside
  changes: number;
  // a stash's files, by name
  statusNames: Record<string, string>;
}

export const gitStashesLoader: LoaderFunction = async ({ params }): Promise<GitStashesLoaderData> => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace Id is required');
  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');
  const { changes, statusNames } = await getGitChanges(GitVCS, workspace);
  // a stash's files are git paths, with / where Windows' names have \
  const names = Object.fromEntries(Object.entries(statusNames).map(([file, name]) => [convertToPosixSep(file), name]));
  return { stashes: await GitVCS.listStashes(), changes: changes.filter(change => change.editable).length, statusNames: names };
};

export interface GitStashResult {
  errors?: string[];
  conflicts?: DocConflict[];
}

/**
 * stash: keeps the uncommitted changes aside (the ones a rollback could undo)
 * and undoes them; apply and pop bring a stash's back, pop dropping it; drop
 * deletes one
 */
export const gitStashAction: ActionFunction = async ({ request, params }): Promise<GitStashResult> => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace Id is required');
  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');

  const formData = await request.formData();
  const intent = formData.get('intent');
  const id = String(formData.get('id') || '');
  const bufferId = await database.bufferChanges();
  try {
    if (intent === 'stash') {
      const { changes } = await getGitChanges(GitVCS, workspace);
      const files = changes.filter(change => change.editable).map(change => ({ filePath: change.path, status: change.status }));
      if (!files.length) {
        return { errors: ['There are no changes to stash.'] };
      }
      await GitVCS.stash(files.map(change => change.filePath), String(formData.get('message') || ''));
      await gitRollback(GitVCS, files);
    } else if (intent === 'apply' || intent === 'pop') {
      await GitVCS.applyStash(id, { drop: intent === 'pop', choices: mergeChoicesFrom(formData) });
    } else if (intent === 'drop') {
      await GitVCS.dropStash(id);
    }
  } catch (err) {
    if (err instanceof GitConflictsError) {
      return { conflicts: err.conflicts };
    }
    return { errors: [err instanceof Error ? err.message : String(err)] };
  } finally {
    await database.flushChanges(bufferId, true);
  }
  return {};
};

export interface GitRollbackChangesResult {
  errors?: string[];
}

export const gitRollbackChangesAction: ActionFunction = async ({
  params,
  request,
}): Promise<GitRollbackChangesResult> => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace Id is required');

  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');

  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);

  const repoId = workspaceMeta?.gitRepositoryId;

  guard(repoId, 'Workspace is not linked to a git repository');

  const gitRepository = await models.gitRepository.getById(repoId);

  guard(gitRepository, 'Git Repository not found');

  const formData = await request.formData();

  const paths = [...formData.getAll('paths')] as string[];
  const changeType = formData.get('changeType') as string;
  try {
    const { changes } = await getGitChanges(GitVCS, workspace);

    const files = changes
      .filter(i =>
        changeType === 'modified'
          ? !i.status.includes('added')
          : i.status.includes('added')
      )
      // only rollback if editable
      .filter(i => i.editable)
      // only rollback if in selected path or for all paths
      .filter(i => paths.length === 0 || paths.includes(i.path))
      .map(i => ({
        filePath: i.path,
        status: i.status,
      }));

    await gitRollback(GitVCS, files);
  } catch (e) {
    const errorMessage =
      e instanceof Error ? e.message : 'Error while rolling back changes';
    return {
      errors: [errorMessage],
    };
  }

  return {};
};

export interface GitStatusResult {
  status: {
    localChanges: number;
  };
}

export const gitStatusAction: ActionFunction = async ({
  params,
}): Promise<GitStatusResult> => {
  const { workspaceId } = params;
  guard(typeof workspaceId === 'string', 'Workspace Id is required');

  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, 'Workspace not found');
  try {
    const { changes } = await getGitChanges(GitVCS, workspace);
    const localChanges = changes.filter(i => i.editable).length;

    return {
      status: {
        localChanges,
      },
    };
  } catch (e) {
    console.error(e);
    return {
      status: {
        localChanges: 0,
      },
    };
  }
};
