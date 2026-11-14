import * as models from '../../models';
import type { GitRepository } from '../../models/git-repository';

export const createGitRepository = async (workspaceId: string, repo: Partial<GitRepository>) => {
  const newRepo = await models.gitRepository.create(repo);
  const meta = await models.workspaceMeta.getOrCreateByParentId(workspaceId);
  await models.workspaceMeta.update(meta, {
    gitRepositoryId: newRepo._id,
  });
};
