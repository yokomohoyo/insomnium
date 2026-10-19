import { ApiSpec, isApiSpec } from '../models/api-spec';
import { isEnvironment } from '../models/environment';
import { isFlow, remapRequests } from '../models/flow';
import { isGrpcRequest } from '../models/grpc-request';
import { BaseModel, getModel } from '../models/index';
import * as models from '../models/index';
import { isUnitTest } from '../models/unit-test';
import { isWorkspace, Workspace } from '../models/workspace';
import { guard } from '../utils/guard';
import { database as db } from './database';
import { generateId } from './misc';
import { ResourceCache, isApiSpecImport, isSubEnvironmentResource } from './import';

export const importResourcesToNewWorkspace = async (projectId: string, _resources?: BaseModel[], workspaceToImport?: Workspace) => {

  const resources = _resources || ResourceCache?.resources;
  guard(resources, 'No resources to import');
  const ResourceIdMap = new Map();
  // in order to support import from api spec yaml
  if (ResourceCache?.type?.id && isApiSpecImport(ResourceCache.type)) {
    const newWorkspace = await models.workspace.create({
      name: workspaceToImport?.name,
      scope: 'design',
      parentId: projectId,
    });
    await models.apiSpec.updateOrCreateForParentId(newWorkspace._id, {
      contents: ResourceCache.content,
      contentType: 'yaml',
      fileName: workspaceToImport?.name,
    });
    return {
      resources,
      workspace: newWorkspace,
    };
  }
  const newWorkspace = await models.workspace.create({
    name: workspaceToImport?.name || 'Imported Workspace',
    scope: workspaceToImport?.scope || 'collection',
    parentId: projectId,
  });
  const apiSpec = resources.find(r => r.type === 'ApiSpec' && r.parentId === workspaceToImport?._id) as ApiSpec;
  const hasApiSpec = newWorkspace.scope === 'design' && isApiSpec(apiSpec);
  // if workspace is not in the resources, there will be no apiSpec, if resource type is set to api spec this could cause a bug
  if (hasApiSpec) {
    // TODO: will overwrite existing api spec, not needed after migrate hack is removed
    await models.apiSpec.updateOrCreateForParentId(newWorkspace._id, {
      contents: apiSpec.contents,
      contentType: apiSpec.contentType,
      fileName: workspaceToImport?.name,
    });

  }

  // If we're importing into a new workspace
  // Map new IDs
  ResourceIdMap.set('__WORKSPACE_ID__', newWorkspace._id);
  workspaceToImport && ResourceIdMap.set(workspaceToImport._id, newWorkspace._id);

  const resourcesWithoutWorkspaceAndApiSpec = resources.filter(
    resource => !isWorkspace(resource) && !isApiSpec(resource)
  );

  for (const resource of resourcesWithoutWorkspaceAndApiSpec) {
    const model = getModel(resource.type);
    model && ResourceIdMap.set(resource._id, generateId(model.prefix));
  }

  // environments an importer gave the base environment as their parent (Bruno's,
  // Postman environment files): the import's own base, or else the new workspace's
  if (resources.some(resource => resource.parentId === '__BASE_ENVIRONMENT_ID__')) {
    const importedBase = resourcesWithoutWorkspaceAndApiSpec.find(resource => isEnvironment(resource) && (resource.parentId === workspaceToImport?._id || resource.parentId === '__WORKSPACE_ID__'));
    ResourceIdMap.set('__BASE_ENVIRONMENT_ID__', importedBase
      ? ResourceIdMap.get(importedBase._id)
      : (await models.environment.getOrCreateForParentId(newWorkspace._id))._id);
  }

  for (const resource of resourcesWithoutWorkspaceAndApiSpec) {
    const model = getModel(resource.type);

    if (model) {
      if (isGrpcRequest(resource)) {
        await db.docCreate(model.type, {
          ...resource,
          _id: ResourceIdMap.get(resource._id),
          protoFileId: ResourceIdMap.get(resource.protoFileId),
          parentId: ResourceIdMap.get(resource.parentId),
        });
      } else if (isUnitTest(resource)) {
        await db.docCreate(model.type, {
          ...resource,
          _id: ResourceIdMap.get(resource._id),
          requestId: ResourceIdMap.get(resource.requestId),
          parentId: ResourceIdMap.get(resource.parentId),
        });

        // and a flow to the new requests
      } else if (isFlow(resource)) {
        await db.docCreate(model.type, {
          ...resource,
          _id: ResourceIdMap.get(resource._id),
          graph: resource.graph && remapRequests(resource.graph, id => ResourceIdMap.get(id)),
          parentId: ResourceIdMap.get(resource.parentId),
        });
      } else {
        await db.docCreate(model.type, {
          ...resource,
          _id: ResourceIdMap.get(resource._id),
          parentId: ResourceIdMap.get(resource.parentId),
        });
      }
    }
  }

  // Use the first environment as the active one
  const subEnvironments = resources.filter(isEnvironment).filter(isSubEnvironmentResource) || [];

  if (subEnvironments.length > 0) {
    const firstSubEnvironment = subEnvironments[0];

    if (firstSubEnvironment) {
      const workspaceMeta = await models.workspaceMeta.getOrCreateByParentId(
        newWorkspace._id
      );

      await models.workspaceMeta.update(workspaceMeta, {
        activeEnvironmentId: ResourceIdMap.get(firstSubEnvironment._id),
      });
    }
  }
  return {
    resources: resources.map(r => ({
      ...r,
      _id: ResourceIdMap.get(r._id),
      parentId: ResourceIdMap.get(r.parentId),
    })),
    workspace: newWorkspace,
  };
};
