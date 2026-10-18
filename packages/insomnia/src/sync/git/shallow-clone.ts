import * as git from 'isomorphic-git';

import type { GitRepository } from '../../models/git-repository';
import { GIT_CLONE_DIR, GIT_INTERNAL_DIR } from './git-vcs';
import { httpClient } from './http-client';
import { MemClient } from './mem-client';
import { routableFSClient } from './routable-fs-client';
import { gitCallbacks } from './utils';

interface Options {
  fsClient: git.PromiseFsClient;
  gitRepository: GitRepository;
}

/**
 * Create a shallow clone into the provided FS plugin. Only the work tree goes
 * there: the git dir gets its own store, as in git-actions.tsx, so a repository
 * file at git/config stays a work-tree file.
 * */
export const shallowClone = async ({ fsClient, gitRepository }: Options) => {
  await git.clone({
    ...gitCallbacks(gitRepository.credentials),
    fs: routableFSClient(fsClient, { [GIT_INTERNAL_DIR]: MemClient.createClient() }),
    http: httpClient,
    dir: GIT_CLONE_DIR,
    gitdir: GIT_INTERNAL_DIR,
    singleBranch: true,
    url: gitRepository.uri,
    depth: 1,
  });
};
