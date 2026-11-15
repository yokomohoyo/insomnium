import type { BaseModel } from '../models/index';
import { DEFAULT_PROJECT_ID } from '../models/project';
import { isWorkspace } from '../models/workspace';
import { guard } from '../utils/guard';
import { database as db } from './database';
import { importGlobalEnvironments } from './global-environments';
import { ResourceCache } from './import';
import { importResourcesToNewWorkspace } from './importResourcesToNewWorkspace';

export async function importResourcesToProject({ projectId = DEFAULT_PROJECT_ID, _resources }: { projectId?: string; _resources?: BaseModel[] }) {

  const scanned = _resources || ResourceCache!.resources;
  guard(scanned, 'No resources to import');

  const bufferId = await db.bufferChanges();
  // globals (Postman's) go to the project, not a new collection
  const resources = await importGlobalEnvironments(projectId, scanned);
  if (!resources.length) {
    await db.flushChanges(bufferId);
    return { resources: scanned };
  }
  if (!resources.find(isWorkspace)) {
    await importResourcesToNewWorkspace(projectId, resources);
    await db.flushChanges(bufferId);
    return { resources };
  }
  const r = await Promise.all(resources.filter(isWorkspace)
    .map(resource => importResourcesToNewWorkspace(projectId, resources, resource)));

  await db.flushChanges(bufferId);
  return { resources: r.flat() };
}
