import { ApiSpec, isApiSpec } from '../models/api-spec';
import { CookieJar, isCookieJar } from '../models/cookie-jar';
import { BaseEnvironment, Environment, isEnvironment } from '../models/environment';
import { GrpcRequest, isGrpcRequest } from '../models/grpc-request';
import { BaseModel, getModel } from '../models/index';
import * as models from '../models/index';
import { isFlow, remapRequests } from '../models/flow';
import { isMcpRequest, McpRequest } from '../models/mcp-request';
import { isRequest, Request } from '../models/request';
import { isUnitTest, UnitTest } from '../models/unit-test';
import { isUnitTestSuite, UnitTestSuite } from '../models/unit-test-suite';
import {
  isWebSocketRequest,
  WebSocketRequest,
} from '../models/websocket-request';
import { isWorkspace, Workspace } from '../models/workspace';
import { convert, InsomniaImporter } from '../utils/importers/convert';
import { guard } from '../utils/guard';
import { database as db } from './database';
import { generateId } from './misc';
import { importResourcesToProject } from './importResourcesToProject';
import { getAppVersion } from './constants';
import { importGlobalEnvironments } from './global-environments';

export interface ExportedModel extends BaseModel {
  _type: string;
}

interface ConvertResult {
  type: InsomniaImporter;
  data: {
    resources: ExportedModel[];
  };
}

export const isSubEnvironmentResource = (environment: Environment) => {
  return !environment.parentId || environment.parentId.startsWith(models.environment.prefix) || environment.parentId.startsWith('__BASE_ENVIRONMENT_ID__');
};

// A {% response %} tag names its request by id, so an import, which gives
// every resource a new id, points the tags in its strings at the new ones, as
// it does a flow's requests. Only quoted ids inside {% %} tags change.
export const remapTemplateIds = <T>(value: T, ids: Map<string, string>): T => {
  if (typeof value === 'string') {
    return value.replace(/{%[\s\S]*?%}/g, tag => tag.replace(/(['"])([a-z]+_[\w-]+)\1/g, (quoted, quote, id) => (ids.has(id) ? `${quote}${ids.get(id)}${quote}` : quoted))) as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => remapTemplateIds(item, ids)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapTemplateIds(item, ids)])) as T;
  }
  return value;
};

// In the order they came: a sort key each for the resources a format gives
// none (a curl list, a Postman collection, a hand-written export), as the same
// millisecond's -Date.now() would tie and sort by id
export const sortKeyer = () => {
  const sortBase = -Date.now();
  return <T extends BaseModel & { metaSortKey?: number }>(resource: T, index: number): T =>
    resource.metaSortKey === undefined && 'metaSortKey' in (getModel(resource.type)?.init() || {})
      ? { ...resource, metaSortKey: sortBase + index }
      : resource;
};

export async function fetchImportContentFromURI(
  { uri, allowLocalFiles = false }: { uri: string; allowLocalFiles?: boolean },
) {
  const url = new URL(uri);

  if (url.origin === 'https://github.com') {
    uri = uri
      .replace('https://github.com', 'https://raw.githubusercontent.com')
      .replace('blob/', '');
  }

  if (uri.match(/^https?:\/\//)) {
    const response = await fetch(uri);
    const content = await response.text();

    return content;
  } else if (uri.match(/^file:\/\//)) {
    // file:// is opt-in. Callers reachable from untrusted input (deep links,
    // anything driven by `params.uri` from a `shell:open` event) must NOT set
    // allowLocalFiles; otherwise a `insomnia://app/import?uri=file:///...` link
    // would read arbitrary user-readable files into the workspace.
    // Trusted callers (the plugin context's `data.import.uri`) opt in.
    if (!allowLocalFiles) {
      throw new Error('Unsupported import URI scheme. Only http(s) URLs are allowed.');
    }
    const path = uri.replace(/^file:\/\//, '');
    const { readFile } = await import('fs/promises');
    return readFile(path, 'utf8');
  } else if (uri.match(/^[a-z][a-z0-9+.-]*:\/\//i)) {
    // Any other scheme (data:, ftp:, javascript:, etc.) is always rejected.
    throw new Error('Unsupported import URI scheme. Only http(s) URLs are allowed.');
  } else {
    // Treat everything else (no scheme) as raw text - preserves the "paste
    // YAML/JSON into the URL field" UX.
    const content = decodeURIComponent(uri);

    return content;
  }
}

export interface ScanResult {
  requests?: (Request | WebSocketRequest | GrpcRequest | McpRequest)[];
  workspaces?: Workspace[];
  environments?: BaseEnvironment[];
  apiSpecs?: ApiSpec[];
  cookieJars?: CookieJar[];
  unitTests?: UnitTest[];
  unitTestSuites?: UnitTestSuite[];
  type?: InsomniaImporter;
  // what the scan found, for a caller that imports it straight away
  resources?: BaseModel[];
  errors: string[];
}

export let ResourceCache: {
  content: string;
  resources: BaseModel[];
  type: InsomniaImporter;
} | null = null;

export async function scanResources({
  content,
}: {
  content: string;
}): Promise<ScanResult> {
  let results: ConvertResult | null = null;

  try {
    results = (await convert(content)) as unknown as ConvertResult;
  } catch (err: unknown) {
    if (err instanceof Error) {
      return {
        errors: [err.message],
      };
    }
  }

  if (!results) {
    return {
      errors: ['No resources found to import.'],
    };
  }

  const { type, data } = results;

  // (a type a later version exports is left out)
  const resources = data.resources.flatMap(r => {
    const { _type, ...model } = r;
    const exported = _type ? models.MODELS_BY_EXPORT_TYPE[_type] : undefined;
    return exported ? [{ ...model, type: exported.type }] : [];
  });

  ResourceCache = {
    resources,
    type,
    content,
  };

  const requests = resources.filter(isRequest);
  const websocketRequests = resources.filter(isWebSocketRequest);
  const mcpRequests = resources.filter(isMcpRequest);
  const grpcRequests = resources.filter(isGrpcRequest);
  const environments = resources.filter(isEnvironment);
  const unitTests = resources.filter(isUnitTest);
  const unitTestSuites = resources.filter(isUnitTestSuite);
  const apiSpecs = resources.filter(isApiSpec);
  const workspaces = resources.filter(isWorkspace);
  const cookieJars = resources.filter(isCookieJar);

  return {
    type,
    unitTests,
    unitTestSuites,
    requests: [...requests, ...websocketRequests, ...grpcRequests, ...mcpRequests],
    workspaces,
    environments,
    apiSpecs,
    cookieJars,
    resources,
    errors: [],
  };
}

export const importPure = async (json: { resources: BaseModel[] } & any) => {
  const _resources = json.resources;
  // console.log("importPure", json);
  return await importResourcesToProject({ _resources });
};

// resources: what a scan returned; left out, what the last scan found (the
// import dialog scans in one step and imports in the next)
export const importResourcesToWorkspace = async ({ workspaceId, resources: scanned }: { workspaceId: string; resources?: BaseModel[] }) => {
  const resources = scanned || ResourceCache?.resources;
  guard(resources, 'No resources to import');
  return await importToWorkspace({ workspaceId, resources });
};

export const importToWorkspace = async ({ workspaceId, resources: imported }: { workspaceId: string; resources: BaseModel[] }) => {

  const bufferId = await db.bufferChanges();
  const ResourceIdMap = new Map();
  const existingWorkspace = await models.workspace.getById(workspaceId);

  guard(
    existingWorkspace,
    `Could not find workspace with id ${workspaceId}`
  );
  const resources = existingWorkspace.parentId ? await importGlobalEnvironments(existingWorkspace.parentId, imported) : imported;
  // Map new IDs
  ResourceIdMap.set(workspaceId, existingWorkspace._id);
  ResourceIdMap.set('__WORKSPACE_ID__', existingWorkspace._id);
  const toImport = resources.find(isWorkspace);
  toImport && ResourceIdMap.set(toImport._id, existingWorkspace._id);

  const optionalResources = resources.filter(
    resource =>
      !isWorkspace(resource) &&
      !isApiSpec(resource) &&
      !isCookieJar(resource) &&
      !isEnvironment(resource)
  );

  // Create new ids for each resource below optionalResources, and the sub
  // environments, first: their strings' tags are pointed at them
  for (const resource of optionalResources) {
    const model = getModel(resource.type);
    model && ResourceIdMap.set(resource._id, generateId(model.prefix));
  }
  for (const environment of resources.filter(isEnvironment).filter(isSubEnvironmentResource)) {
    const model = getModel(environment.type);
    model && ResourceIdMap.set(environment._id, generateId(model.prefix));
  }

  const baseEnvironment = await models.environment.getOrCreateForParentId(workspaceId);
  guard(baseEnvironment, 'Could not create base environment');

  // the imported collection's own variables (its base environment): those this
  // workspace doesn't have yet, so an import adds them without changing a
  // value set here
  const importedBase = remapTemplateIds(resources.filter(isEnvironment).find(environment => !isSubEnvironmentResource(environment)), ResourceIdMap);
  const added = Object.keys(importedBase?.data || {}).filter(key => !(key in (baseEnvironment.data || {})));
  if (importedBase && added.length) {
    const order = baseEnvironment.dataPropertyOrder;
    await models.environment.update(baseEnvironment, {
      data: { ...importedBase.data, ...baseEnvironment.data },
      // the editor's key order, when it keeps one, with the new keys after
      ...(order?.['&'] ? { dataPropertyOrder: { ...order, '&': [...order['&'], ...added] } } : {}),
    });
  }

  const subEnvironments = resources.filter(isEnvironment).filter(isSubEnvironmentResource) || [];

  for (const environment of subEnvironments) {
    await db.docCreate(environment.type, {
      ...remapTemplateIds(environment, ResourceIdMap),
      _id: ResourceIdMap.get(environment._id),
      parentId: baseEnvironment._id,
    });
  }

  const sortKeyed = sortKeyer();

  // Preserve optionalResource relationships
  for (const [index, unsorted] of optionalResources.entries()) {
    const resource = remapTemplateIds(sortKeyed(unsorted, index), ResourceIdMap);
    const model = getModel(resource.type);
    if (model) {
      // Make sure we point to the new proto file
      if (isGrpcRequest(resource)) {
        await db.docCreate(model.type, {
          ...resource,
          _id: ResourceIdMap.get(resource._id),
          protoFileId: ResourceIdMap.get(resource.protoFileId),
          parentId: ResourceIdMap.get(resource.parentId),
        });

        // Make sure we point unit test to the new request
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

  await db.flushChanges(bufferId);

  return {
    resources: resources.map(r => ({
      ...r,
      _id: ResourceIdMap.get(r._id),
      parentId: ResourceIdMap.get(r.parentId),
    })),
    workspace: existingWorkspace,
  };
};
export const isApiSpecImport = ({ id }: Pick<InsomniaImporter, 'id'>) =>
  id === 'openapi3' || id === 'swagger2';

export const dummyStartingWorkspace = () => {
  const currentUnixTime = Date.now();
  const oneSec = 1000;
  const wId = generateId(models.workspace.prefix);
  const rId = generateId(models.request.prefix);
  const eId = generateId(models.environment.prefix);
  const jId = generateId(models.cookieJar.prefix);
  return [({
    "_type": "export",
    "__export_format": 4,
    "__export_date": "2023-10-04T20:25:03.318Z",
    "__export_source": "insomnia.desktop.app:v0.1.3",
    "resources": [
      {
        "_id": rId,
        "parentId": wId,
        "modified": currentUnixTime - oneSec * 3,
        "created": currentUnixTime - oneSec * 3,
        "url": "",
        "name": "New Request",
        "description": "",
        "method": "GET",
        "body": {},
        "parameters": [],
        "headers": [{ "name": "User-Agent", "value": "insomnium/" + getAppVersion() }],
        "authentication": {},
        "metaSortKey": -(currentUnixTime - oneSec * 3 - 1),
        "isPrivate": false,
        "settingStoreCookies": true,
        "settingSendCookies": true,
        "settingDisableRenderRequestBody": false,
        "settingEncodeUrl": true,
        "settingRebuildPath": true,
        "settingFollowRedirects": "global",
        "type": "Request",
      },
      {
        "_id": wId,
        "parentId": null,
        "modified": currentUnixTime - oneSec * 2,
        "created": currentUnixTime - oneSec * 2,
        "name": "My Collection",
        "description": "",
        "scope": "collection",
        // "_type": "workspace",
        "type": "Workspace",
        // hmm where is the fn for import field transfromation from Insomnia
      },
      {
        "_id": eId,
        "parentId": wId,
        "modified": currentUnixTime - oneSec * 1,
        "created": currentUnixTime - oneSec * 1,
        "name": "Base Environment",
        "data": {},
        "dataPropertyOrder": null,
        "color": null,
        "isPrivate": false,
        "metaSortKey": currentUnixTime - oneSec * 1,
        "type": "Environment",
      },
      {
        "_id": jId,
        "parentId": wId,
        "modified": currentUnixTime,
        "created": currentUnixTime,
        "name": "Default Jar",
        "cookies": [],
        "type": "CookieJar",
      },
    ],
  }), wId, rId];
};
