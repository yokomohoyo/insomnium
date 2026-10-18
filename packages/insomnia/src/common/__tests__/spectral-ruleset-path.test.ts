import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env as processEnv } from 'node:process';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { spectralRulesetFor } from '../spectral-ruleset-path';

describe('spectralRulesetFor()', () => {
  let dataPath: string;
  let workspaceId: string;
  const previousDataPath = processEnv['INSOMNIA_DATA_PATH'];

  beforeEach(async () => {
    await globalBeforeEach();
    dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ruleset-path-'));
    processEnv['INSOMNIA_DATA_PATH'] = dataPath;
    workspaceId = (await models.workspace.create({ name: 'Pets', scope: 'design', parentId: 'proj_1' }))._id;
    await models.workspaceMeta.getOrCreateByParentId(workspaceId);
  });
  afterEach(() => {
    processEnv['INSOMNIA_DATA_PATH'] = previousDataPath;
    fs.rmSync(dataPath, { recursive: true, force: true });
  });

  const inRepository = (repositoryId: string) => {
    const file = path.join(dataPath, 'version-control', 'git', repositoryId, 'other', '.spectral.yaml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'extends: spectral:oas\n');
    return file;
  };

  it('uses the built-in rules when there is nothing else', async () => {
    expect(await spectralRulesetFor(workspaceId)).toEqual({ rulesetPath: '', source: 'built-in' });
  });

  it("uses the git repository's .spectral.yaml when it has one", async () => {
    const file = inRepository('git_1');
    await models.workspaceMeta.updateByParentId(workspaceId, { gitRepositoryId: 'git_1' });

    expect(await spectralRulesetFor(workspaceId)).toEqual({ rulesetPath: file, source: 'git' });

    await models.workspaceMeta.updateByParentId(workspaceId, { gitRepositoryId: 'git_2' });
    expect(await spectralRulesetFor(workspaceId)).toEqual({ rulesetPath: '', source: 'built-in' });
  });

  it("uses a chosen file over the repository's, even when it's gone, so the lint says so", async () => {
    inRepository('git_1');
    const chosen = path.join(dataPath, 'mine.yaml');
    await models.workspaceMeta.updateByParentId(workspaceId, { gitRepositoryId: 'git_1', spectralRulesetPath: chosen });

    expect(await spectralRulesetFor(workspaceId)).toEqual({ rulesetPath: chosen, source: 'chosen' });
  });
});
