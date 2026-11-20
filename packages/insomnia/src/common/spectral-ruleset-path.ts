// The Spectral ruleset a design document is linted with: a file chosen for it
// in the Spec tab (kept on this computer, in its WorkspaceMeta), else a
// .spectral.yaml at the root of its git repository, else the built-in OpenAPI
// rules. The main process loads it as plain data only (main/spectral-lint.ts).
// The OWASP API Security Top 10 rules can be added to any of them, per document.
import { env as processEnv } from 'node:process';

import electron from 'electron';
import { stat } from 'fs/promises';
import path from 'path';

import * as models from '../models';

export type RulesetSource = 'chosen' | 'git' | 'built-in';

// A finding of the OWASP rules, by its rule code. They advise on the API's
// design, so they never hold up making requests from the spec.
export const isOwaspCode = (code: string | number) => String(code).startsWith('owasp:');

const isFile = async (file: string) => {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
};

export async function spectralRulesetFor(workspaceId: string): Promise<{ rulesetPath: string; source: RulesetSource; owasp: boolean }> {
  const workspaceMeta = await models.workspaceMeta.getByParentId(workspaceId);
  const owasp = !!workspaceMeta?.spectralOwasp;
  // a chosen file that's gone is still used, so the lint results say so
  if (workspaceMeta?.spectralRulesetPath) {
    return { rulesetPath: workspaceMeta.spectralRulesetPath, source: 'chosen', owasp };
  }
  if (workspaceMeta?.gitRepositoryId) {
    // the renderer's app, or the main process's for the MCP tools
    const inRepository = path.join(
      processEnv['INSOMNIA_DATA_PATH'] || (process.type === 'renderer' ? window.app : electron.app).getPath('userData'),
      `version-control/git/${workspaceMeta.gitRepositoryId}/other/.spectral.yaml`,
    );
    if (await isFile(inRepository)) {
      return { rulesetPath: inRepository, source: 'git', owasp };
    }
  }
  return { rulesetPath: '', source: 'built-in', owasp };
}
