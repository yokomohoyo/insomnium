import fs from 'node:fs';

import { scanResources } from '../common/import';
import { importResourcesToProject } from '../common/importResourcesToProject';
import * as models from '../models';
import { DEFAULT_PROJECT_ID } from '../models/project';
import type { Workspace } from '../models/workspace';

// Imports a collection file the way the app's Import does, into the in-memory
// database, and returns the workspaces it added.
export async function loadCollection(filePath: string): Promise<Workspace[]> {
  const content = await fs.promises.readFile(filePath, 'utf8');
  const before = new Set((await models.workspace.all()).map(({ _id }) => _id));
  const { errors, requests = [] } = await scanResources({ content });
  if (errors.length) {
    throw new Error(`Could not import ${filePath}: ${errors.join('; ')}`);
  }
  if (!requests.length) {
    throw new Error(`${filePath} has no requests (an OpenAPI file only makes a design document)`);
  }
  await importResourcesToProject({ projectId: DEFAULT_PROJECT_ID });
  return (await models.workspace.all()).filter(({ _id }) => !before.has(_id));
}

// Makes the named sub environment active in each workspace that has one, and
// writes the variables into each workspace's active (or base) environment.
// Throws when a name is given that no workspace has.
export async function applyEnvironment(workspaces: Workspace[], name: string | undefined, variables: Record<string, string>) {
  const names = new Set<string>();
  let found = !name;
  for (const workspace of workspaces) {
    const base = await models.environment.getOrCreateForParentId(workspace._id);
    const subs = await models.environment.findByParentId(base._id);
    subs.forEach(sub => names.add(sub.name));
    const chosen = name ? subs.find(sub => sub.name === name) : undefined;
    if (chosen) {
      found = true;
      const meta = await models.workspaceMeta.getOrCreateByParentId(workspace._id);
      await models.workspaceMeta.update(meta, { activeEnvironmentId: chosen._id });
    }
    if (Object.keys(variables).length) {
      const target = chosen || base;
      await models.environment.update(target, { data: { ...target.data, ...variables } });
    }
  }
  if (!found) {
    throw new Error(`No environment named '${name}'. The collections have: ${[...names].join(', ') || 'no sub environments'}`);
  }
}
