import * as models from '../models';
import type { BaseModel } from '../models';
import type { Environment } from '../models/environment';
import { isEnvironment } from '../models/environment';
import { GLOBAL_ENVIRONMENT_IMPORT_ID } from '../utils/importers/entities';

// A project's global environments hold variables for every collection in it:
// a base one, whose parent is the project, and sub environments under it, of
// which each collection may use one (WorkspaceMeta.activeGlobalEnvironmentId).
// They render under the collection's own environments, and they aren't part
// of a collection, so its exports and Git Sync leave them out.

export interface GlobalEnvironments {
  base: Environment | null;
  // the sub environment the collection uses
  active: Environment | null;
}

export async function getGlobalEnvironments(projectId: string | null | undefined, workspaceId: string): Promise<GlobalEnvironments> {
  const base = projectId ? await models.environment.getByParentId(projectId) : null;
  if (!base) {
    return { base: null, active: null };
  }
  const meta = await models.workspaceMeta.getByParentId(workspaceId);
  const chosen = meta?.activeGlobalEnvironmentId ? await models.environment.getById(meta.activeGlobalEnvironmentId) : null;
  return { base, active: chosen?.parentId === base._id ? chosen : null };
}

const isGlobalImport = (resource: BaseModel) => isEnvironment(resource) && resource.parentId === GLOBAL_ENVIRONMENT_IMPORT_ID;

// Imported globals join the project's global base environment, over what it
// had; the rest is imported as usual
export async function importGlobalEnvironments<T extends BaseModel>(projectId: string, resources: T[]): Promise<T[]> {
  const globals = resources.filter(isGlobalImport) as unknown as Environment[];
  if (globals.length) {
    const base = await models.environment.getOrCreateForParentId(projectId);
    const data = globals.reduce((merged, { data }) => ({ ...merged, ...data }), base.data);
    await models.environment.update(base, { data });
  }
  return resources.filter(resource => !isGlobalImport(resource));
}
