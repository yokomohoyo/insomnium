// Generating a collection from a design document's spec again updates the
// requests it made before, instead of adding a second copy. Each generated
// request keeps the id the importer gave its operation (openapi-3.ts derives
// it from the operationId, or else the method and path), so the next run finds
// it. The spec decides a request's method and URL and adds the parameters and
// headers it gains; what you've set (names, values, bodies, auth, scripts and
// assertions) stays. Requests whose operation left the spec are reported, not
// deleted.
import * as models from '../models';
import type { BaseModel } from '../models';
import { type Environment, isEnvironment } from '../models/environment';
import { getAuthStrategies, isRequest, type Request } from '../models/request';
import { isRequestGroup } from '../models/request-group';
import { guard } from '../utils/guard';
import { database as db } from './database';
import { generateId } from './misc';

// the ids the importers give the workspace and its base environment
const SPEC_WORKSPACE_ID = '__WORKSPACE_ID__';
const SPEC_BASE_ENVIRONMENT_ID = '__BASE_ENVIRONMENT_ID__';

export interface SpecSyncResult {
  added: Request[];
  updated: Request[];
  unchanged: Request[];
  // generated before, but their operations are no longer in the spec
  notInSpec: Request[];
}

// the importer's id for an operation, when it follows the operation: Swagger
// 2.0 numbers the ones without an operationId in order, so those go by method
// and URL instead
const operationKey = (request: Request) =>
  /^__REQUEST_\d+__$/.test(request._id) ? `[${request.method}]${request.url}` : request._id;

const isEmptyBody = (body: Request['body'] | undefined) =>
  !body || (!body.mimeType && !body.text && !body.fileName && !body.params?.length);

// existing entries as they are, then the spec's that aren't there yet
const withMissing = <T extends { name: string }>(existing: T[] = [], fromSpec: T[] = [], key = (name: string) => name) =>
  [...existing, ...fromSpec.filter(entry => !existing.some(other => key(other.name) === key(entry.name)))];

const withMissingData = (existing: Record<string, any> = {}, fromSpec: Record<string, any> = {}) =>
  ({ ...fromSpec, ...existing });

const changes = <T extends object>(doc: T, patch: Partial<T>) =>
  Object.entries(patch).some(([key, value]) => JSON.stringify(doc[key as keyof T]) !== JSON.stringify(value));

export async function syncSpecToWorkspace({ workspaceId, resources }: { workspaceId: string; resources: BaseModel[] }): Promise<SpecSyncResult> {
  const workspace = await models.workspace.getById(workspaceId);
  guard(workspace, `Could not find workspace with id ${workspaceId}`);

  const descendants = await db.withDescendants(workspace);
  const existingRequests = descendants.filter(isRequest);
  const existingFolders = descendants.filter(isRequestGroup);
  const result: SpecSyncResult = { added: [], updated: [], unchanged: [], notInSpec: [] };

  console.log('[spec-sync] start', descendants.length);
  const bufferId = await db.bufferChanges();
  console.log('[spec-sync] buffered', bufferId);
  try {
    // a tag's folder: the workspace's top-level folder of that name, made only
    // when a new request goes in it
    const specFolders = resources.filter(isRequestGroup);
    const folderIds = new Map<string, string>([[SPEC_WORKSPACE_ID, workspaceId]]);
    const folderFor = async (specParentId: string) => {
      const known = folderIds.get(specParentId);
      if (known) {
        return known;
      }
      const specFolder = specFolders.find(folder => folder._id === specParentId);
      if (!specFolder) {
        return workspaceId;
      }
      const folder = existingFolders.find(existing => existing.parentId === workspaceId && existing.name === specFolder.name)
        || await models.requestGroup.create({ name: specFolder.name, description: specFolder.description, parentId: workspaceId });
      folderIds.set(specParentId, folder._id);
      return folder._id;
    };

    const specRequests = resources.filter(isRequest);
    const specIds = new Set(specRequests.map(operationKey));
    const claimed = new Set<string>();
    for (const fromSpec of specRequests) {
      const specRequestId = operationKey(fromSpec);
      // every request generated for this operation (copies of one too); else,
      // one made before requests kept their operation's id, by method and URL
      let matches = existingRequests.filter(request => request.specRequestId === specRequestId);
      if (!matches.length) {
        const legacy = existingRequests.find(request => !request.specRequestId && !claimed.has(request._id)
          && request.method === fromSpec.method && request.url === fromSpec.url);
        matches = legacy ? [legacy] : [];
      }

      if (!matches.length) {
        const { _id: _specId, parentId, ...fields } = fromSpec;
        const created = await models.request.create({ ...fields, parentId: await folderFor(parentId || SPEC_WORKSPACE_ID), specRequestId });
        result.added.push(created);
        continue;
      }

      for (const existing of matches) {
        claimed.add(existing._id);
        const patch: Partial<Request> = {
          specRequestId,
          method: fromSpec.method,
          url: fromSpec.url,
          parameters: withMissing(existing.parameters, fromSpec.parameters),
          headers: withMissing(existing.headers, fromSpec.headers, name => name.toLowerCase()),
          ...(isEmptyBody(existing.body) && !isEmptyBody(fromSpec.body) ? { body: fromSpec.body } : {}),
          ...(!getAuthStrategies(existing.authentication).length && getAuthStrategies(fromSpec.authentication).length
            ? { authentication: fromSpec.authentication }
            : {}),
          ...(!existing.description && fromSpec.description ? { description: fromSpec.description } : {}),
        };
        if (changes(existing, patch)) {
          result.updated.push(await models.request.update(existing, patch));
        } else {
          result.unchanged.push(existing);
        }
      }
    }
    console.log('[spec-sync] requests', result.added.length, result.updated.length);
    result.notInSpec = existingRequests.filter(request => request.specRequestId && !specIds.has(request.specRequestId));

    // the spec's variables (base_url, a server's host and path) that aren't set yet
    const baseEnvironment = await models.environment.getOrCreateForParentId(workspaceId);
    const specEnvironments = resources.filter(isEnvironment);
    const specBase = specEnvironments.find(environment => environment._id === SPEC_BASE_ENVIRONMENT_ID);
    if (specBase) {
      const data = withMissingData(baseEnvironment.data, specBase.data);
      if (changes(baseEnvironment, { data })) {
        await models.environment.update(baseEnvironment, { data });
      }
    }
    const subEnvironments: Environment[] = await models.environment.findByParentId(baseEnvironment._id);
    for (const fromSpec of specEnvironments.filter(environment => environment.parentId === SPEC_BASE_ENVIRONMENT_ID)) {
      const existing = subEnvironments.find(environment => environment.name === fromSpec.name);
      if (existing) {
        const data = withMissingData(existing.data, fromSpec.data);
        if (changes(existing, { data })) {
          await models.environment.update(existing, { data });
        }
      } else {
        const { _id: _specId, ...fields } = fromSpec;
        await models.environment.create({ ...fields, parentId: baseEnvironment._id });
      }
    }
    console.log('[spec-sync] environments');
  } finally {
    await db.flushChanges(bufferId);
    console.log('[spec-sync] flushed');
  }
  return result;
}

const described = (request: Request) => `${request.method} ${request.name || request.url}`;

// what a run changed, for the alert after Generate Request Collection; empty
// when it made the collection for the first time
export function specSyncSummary({ added, updated, unchanged, notInSpec }: SpecSyncResult): string {
  if (!updated.length && !unchanged.length && !notInSpec.length) {
    return '';
  }
  const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
  const lines = [`Updated ${count(updated.length, 'request')} and added ${added.length}; ${unchanged.length} already matched the spec.`];
  if (notInSpec.length) {
    lines.push(`No longer in the spec, so left as they are: ${notInSpec.map(described).join(', ')}.`);
  }
  return lines.join(' ');
}
