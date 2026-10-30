// The Spectral ruleset a design document is linted with: a file chosen for it
// in the Spec tab (kept on this computer, in its WorkspaceMeta), else a
// .spectral.yaml at the root of its git repository, else the built-in OpenAPI
// rules. The main process loads it as plain data only (main/spectral-lint.ts).
import electron from 'electron';
import { stat } from 'fs/promises';
import { env as processEnv } from 'node:process';
import path from 'path';

import * as models from '../models';

export type RulesetSource = 'chosen' | 'git' | 'built-in';

const isFile = async (file: string) => {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
};

export async function spectralRulesetFor(workspaceId: string): Promise<{ rulesetPath: string; source: RulesetSource }> {
  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);
  // a chosen file that's gone is still used, so the lint results say so
  if (workspaceMeta?.spectralRulesetPath) {
    return { rulesetPath: workspaceMeta.spectralRulesetPath, source: 'chosen' };
  }
  if (workspaceMeta?.gitRepositoryId) {
    // the renderer's app, or the main process's for the MCP tools
    const inRepository = path.join(
      processEnv['INSOMNIA_DATA_PATH'] || (process.type === 'renderer' ? window.app : electron.app).getPath('userData'),
      `version-control/git/${workspaceMeta.gitRepositoryId}/other/.spectral.yaml`,
    );
    if (await isFile(inRepository)) {
      return { rulesetPath: inRepository, source: 'git' };
    }
  }
  return { rulesetPath: '', source: 'built-in' };
}
