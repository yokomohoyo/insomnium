import React from 'react';
import { LoaderFunction, Outlet, useLoaderData } from 'react-router-dom';

import { SortOrder } from '../../common/constants';
import { database } from '../../common/database';
import { getGlobalEnvironments } from '../../common/global-environments';
import { fuzzyMatchAll } from '../../common/misc';
import { sortMethodMap } from '../../common/sorting';
import type { StoreStamp, StoreWrite } from '../../common/sqlite-store';
import * as models from '../../models';
import type { BaseModel } from '../../models';
import { ApiSpec } from '../../models/api-spec';
import { CaCertificate } from '../../models/ca-certificate';
import { ClientCertificate } from '../../models/client-certificate';
import { CookieJar } from '../../models/cookie-jar';
import { Environment } from '../../models/environment';
import { GitRepository } from '../../models/git-repository';
import { GrpcRequest } from '../../models/grpc-request';
import { GrpcRequestMeta } from '../../models/grpc-request-meta';
import { sortProjects } from '../../models/helpers/project';
import type { McpRequest } from '../../models/mcp-request';
import { Project } from '../../models/project';
import { Request } from '../../models/request';
import { isRequestGroup, RequestGroup } from '../../models/request-group';
import { RequestGroupMeta } from '../../models/request-group-meta';
import { RequestMeta } from '../../models/request-meta';
import {
  WebSocketRequest,
} from '../../models/websocket-request';
import { Workspace } from '../../models/workspace';
import { WorkspaceMeta } from '../../models/workspace-meta';
import { guard } from '../../utils/guard';

type Collection = Child[];

export interface WorkspaceLoaderData {
  activeWorkspace: Workspace;
  activeWorkspaceMeta: WorkspaceMeta;
  activeProject: Project;
  gitRepository: GitRepository | null;
  activeEnvironment: Environment;
  // the project's global sub environment the collection uses
  activeGlobalEnvironment: Environment | null;
  activeCookieJar: CookieJar;
  baseEnvironment: Environment;
  subEnvironments: Environment[];
  activeApiSpec: ApiSpec | null;
  clientCertificates: ClientCertificate[];
  caCertificate: CaCertificate | null;
  projects: Project[];
  requestTree: Child[];
  grpcRequests: GrpcRequest[];
  collection: Collection;
}
export interface Child {
  doc: Request | GrpcRequest | WebSocketRequest | McpRequest | RequestGroup;
  children: Child[];
  collapsed: boolean;
  hidden: boolean;
  pinned: boolean;
  level: number;
  ancestors?: string[];
}

export const workspaceLoader: LoaderFunction = async ({
  request,
  params,
}): Promise<WorkspaceLoaderData> => {
  const { projectId, workspaceId } = params;
  guard(workspaceId, 'Workspace ID is required');
  guard(projectId, 'Project ID is required');

  const activeWorkspace = await models.workspace.getById(workspaceId);
  guard(activeWorkspace, 'Workspace not found');

  // I don't know what to say man, this is just how it is
  await models.environment.getOrCreateForParentId(workspaceId);
  await models.cookieJar.getOrCreateForParentId(workspaceId);

  const activeProject = await models.project.getById(projectId);
  guard(activeProject, 'Project not found');

  const activeWorkspaceMeta = await models.workspaceMeta.getOrCreateByParentId(
    workspaceId,
  );
  guard(activeWorkspaceMeta, 'Workspace meta not found');
  const gitRepository = await models.gitRepository.getById(
    activeWorkspaceMeta.gitRepositoryId || '',
  );

  const baseEnvironment = await models.environment.getByParentId(workspaceId);
  guard(baseEnvironment, 'Base environment not found');

  const subEnvironments = (
    await models.environment.findByParentId(baseEnvironment._id)
  ).sort((e1, e2) => e1.metaSortKey - e2.metaSortKey);

  const activeEnvironment =
    subEnvironments.find(
      ({ _id }) => activeWorkspaceMeta.activeEnvironmentId === _id,
    ) || baseEnvironment;

  const activeCookieJar = await models.cookieJar.getOrCreateForParentId(
    workspaceId,
  );
  guard(activeCookieJar, 'Cookie jar not found');

  const activeApiSpec = await models.apiSpec.getByParentId(workspaceId);
  const clientCertificates = await models.clientCertificate.findByParentId(
    workspaceId,
  );

  const allProjects = await models.project.all();

  const projects = sortProjects(allProjects);

  const searchParams = new URL(request.url).searchParams;
  const filter = searchParams.get('filter');
  const sortOrder = searchParams.get('sortOrder') as SortOrder;
  const sortFunction = sortMethodMap[sortOrder] || sortMethodMap['type-manual'];

  const read = await readCollection(activeWorkspace._id);
  const grpcReqs = [...read.docs[models.grpcRequest.type].values()] as GrpcRequest[];
  const allRequests = TREE_TYPES.flatMap(type => [...read.docs[type].values()]);
  const grpcAndRequestMetas = [...read.metas.values()];
  const requestGroupMetas = [...read.folderMetas.values()];

  // by parentId, so the tree is built in one pass rather than a scan per doc
  const childrenOf = groupBy(allRequests, r => r.parentId);
  const pinnedById = firstBy(grpcAndRequestMetas, m => m.parentId);
  const collapsedById = firstBy(requestGroupMetas, m => m.parentId);

  // second recursion to build the tree
  const getCollectionTree = async ({
    parentId,
    level,
    parentIsCollapsed,
    ancestors,
  }: {
      parentId: string; level: number; parentIsCollapsed: boolean; ancestors: string[];
  }): Promise<Child[]> => {
    const levelReqs = [...(childrenOf.get(parentId) || [])];

    const childrenWithChildren: Child[] = await Promise.all(levelReqs
        .sort(sortFunction)
        .map(async (doc): Promise<Child> => {
          const isMatched = (filter: string): boolean =>
            Boolean(fuzzyMatchAll(
              filter,
              [
                doc.name,
                doc.description,
                ...(isRequestGroup(doc) ? [] : [doc.url]),
              ],
              { splitSpace: true, loose: true }
            )?.indexes);
          const shouldHide = Boolean(filter && !isMatched(filter));
          const hidden = parentIsCollapsed || shouldHide;

          const pinned =
            !isRequestGroup(doc) && pinnedById.get(doc._id)?.pinned || false;
          const collapsed = filter
            ? false
            : parentIsCollapsed ||
              (isRequestGroup(doc) &&
              collapsedById.get(doc._id)?.collapsed) ||
              false;

          const docAncestors = [...ancestors, parentId];

          return {
            doc,
            pinned,
            collapsed,
            hidden,
            level,
            ancestors: docAncestors,
            children: await getCollectionTree({
              parentId: doc._id,
              level: level + 1,
              parentIsCollapsed: collapsed,
              ancestors: docAncestors,
            }),
          };
        }),
    );

    return childrenWithChildren;
  };
  const requestTree = await getCollectionTree({
    parentId: activeWorkspace._id,
    level: 0,
    parentIsCollapsed: false,
    ancestors: [],
  });

  function flattenTree() {
    const collection: Collection = [];
    const tree = requestTree;

    const build = (node: Child) => {
      if (isRequestGroup(node.doc)) {
        collection.push(node);
        node.children.forEach(child => build(child));
      } else {
        collection.push(node);
      }
    };
    tree.forEach(node => build(node));

    return collection;
  }

  return {
    activeWorkspace,
    activeProject,
    gitRepository,
    activeWorkspaceMeta,
    activeCookieJar,
    activeEnvironment,
    activeGlobalEnvironment: (await getGlobalEnvironments(projectId, workspaceId)).active,
    subEnvironments,
    baseEnvironment,
    activeApiSpec,
    clientCertificates,
    caCertificate: await models.caCertificate.findByParentId(workspaceId),
    projects,
    requestTree,
    // TODO: remove this state hack when the grpc responses go somewhere else
    grpcRequests: grpcReqs,
    collection: flattenTree(),
  };
};

type TreeDoc = Request | RequestGroup | GrpcRequest | WebSocketRequest | McpRequest;
// in the order the tree had them before: requests, folders, gRPC, WebSocket, MCP
const TREE_TYPES = [models.request.type, models.requestGroup.type, models.grpcRequest.type, models.webSocketRequest.type, models.mcpRequest.type];
const REQUEST_TYPES = TREE_TYPES.filter(type => type !== models.requestGroup.type);
const META_TYPES = [models.requestMeta.type, models.grpcRequestMeta.type];

// A workspace's tree as the last load read it. The loader runs on every
// revalidation, every save in the window included (each pause while typing in
// the URL bar), and read the whole collection each time. Now it asks the
// database what was written since its last read, and reads just those docs,
// unless a folder changed: then, or when the database can't say, it reads it all.
interface CollectionRead {
  workspaceId: string;
  stamp: StoreStamp;
  // the workspace's id and its folders'
  parentIds: Set<string>;
  docs: Record<string, Map<string, TreeDoc>>;
  // the requests' metas (and gRPC requests'), and the folders', by their ids
  metas: Map<string, RequestMeta | GrpcRequestMeta>;
  folderMetas: Map<string, RequestGroupMeta>;
}
let lastRead: CollectionRead | undefined;

// for tests: the next load reads it all
export const forgetCollectionRead = () => {
  lastRead = undefined;
};

async function readCollection(workspaceId: string): Promise<CollectionRead> {
  const previous = lastRead?.workspaceId === workspaceId ? lastRead : undefined;
  // (asked before reading, so what is written meanwhile is read again next time)
  const { stamp, changes } = await database.changesSince(previous?.stamp ?? null);
  const read = (previous && changes && await readChanges(previous, stamp, changes)) || await readAll(workspaceId, stamp);
  // (a load begun earlier can finish later)
  if (!lastRead || lastRead.workspaceId !== workspaceId || lastRead.stamp.epoch !== stamp.epoch || lastRead.stamp.version <= stamp.version) {
    lastRead = read;
  }
  return read;
}

async function readAll(workspaceId: string, stamp: StoreStamp): Promise<CollectionRead> {
  // the workspace and all its folders' ids, a query per level (not per folder)
  const listOfParentIds = [workspaceId];
  const seen = new Set(listOfParentIds);
  for (let level = listOfParentIds; level.length > 0;) {
    level = (await database.find<RequestGroup>(models.requestGroup.type, { parentId: { $in: level } }))
      .map(r => r._id)
      .filter(id => !seen.has(id));
    level.forEach(id => seen.add(id));
    listOfParentIds.push(...level);
  }

  const docs: CollectionRead['docs'] = {};
  for (const type of TREE_TYPES) {
    const found = await database.find<TreeDoc>(type, { parentId: { $in: listOfParentIds } });
    docs[type] = new Map(found.map(doc => [doc._id, doc]));
  }
  const ids = (types: string[]) => types.flatMap(type => [...docs[type].keys()]);
  const requestMetas = await database.find<RequestMeta>(models.requestMeta.type, { parentId: { $in: ids([models.request.type, models.webSocketRequest.type, models.mcpRequest.type]) } });
  const grpcRequestMetas = await database.find<GrpcRequestMeta>(models.grpcRequestMeta.type, { parentId: { $in: ids([models.grpcRequest.type]) } });
  const requestGroupMetas = await database.find<RequestGroupMeta>(models.requestGroupMeta.type, { parentId: { $in: listOfParentIds } });
  return {
    workspaceId,
    stamp,
    parentIds: seen,
    docs,
    metas: new Map([...requestMetas, ...grpcRequestMetas].map(meta => [meta._id, meta])),
    folderMetas: new Map(requestGroupMetas.map(meta => [meta._id, meta])),
  };
}

// The previous read with the docs written since: null when a folder was, as
// what belongs to the tree then has to be worked out again
async function readChanges(previous: CollectionRead, stamp: StoreStamp, changes: StoreWrite[]): Promise<CollectionRead | null> {
  const folders = previous.docs[models.requestGroup.type];
  const relevant = changes.filter(({ id, type }) => type === null
    ? TREE_TYPES.some(t => previous.docs[t].has(id)) || previous.metas.has(id) || previous.folderMetas.has(id)
    : TREE_TYPES.includes(type) || META_TYPES.includes(type) || type === models.requestGroupMeta.type);
  if (relevant.some(({ id, type }) => type === models.requestGroup.type || (type === null && folders.has(id)))) {
    return null;
  }
  if (!relevant.length) {
    return { ...previous, stamp };
  }

  const read: CollectionRead = {
    ...previous,
    stamp,
    docs: { ...previous.docs },
    metas: new Map(previous.metas),
    folderMetas: new Map(previous.folderMetas),
  };
  const changed = (type: string) => relevant.filter(change => change.type === type).map(change => change.id);
  const fetch = async <T extends BaseModel>(type: string, ids: string[]) =>
    new Map((ids.length ? await database.find<T>(type, { _id: { $in: ids } }) : []).map(doc => [doc._id, doc]));

  // removed
  for (const { id, type } of relevant) {
    if (type === null) {
      for (const t of REQUEST_TYPES) {
        if (read.docs[t].has(id)) {
          read.docs[t] = new Map(read.docs[t]);
          read.docs[t].delete(id);
        }
      }
      read.metas.delete(id);
      read.folderMetas.delete(id);
    }
  }
  // requests: in the tree when under the workspace or one of its folders (moved
  // in or out otherwise), with their metas when new to it
  const added: Record<string, string[]> = {};
  for (const type of REQUEST_TYPES) {
    const ids = changed(type);
    if (!ids.length) {
      continue;
    }
    const found = await fetch<TreeDoc>(type, ids);
    const docs = read.docs[type] = new Map(read.docs[type]);
    let adding = false;
    for (const id of ids) {
      const doc = found.get(id);
      if (doc && previous.parentIds.has(doc.parentId)) {
        if (!docs.has(id)) {
          adding = true;
          (added[type === models.grpcRequest.type ? models.grpcRequestMeta.type : models.requestMeta.type] ??= []).push(id);
        }
        docs.set(id, doc);
      } else {
        docs.delete(id);
      }
    }
    // in the order reading them all gives (by created), which breaks the sort's ties
    if (adding) {
      read.docs[type] = new Map([...docs].sort(([, a], [, b]) => a.created - b.created));
    }
  }
  const inTree = (id: string) => REQUEST_TYPES.some(type => read.docs[type].has(id));
  for (const type of META_TYPES) {
    const found = await fetch<RequestMeta | GrpcRequestMeta>(type, changed(type));
    for (const id of changed(type)) {
      const meta = found.get(id);
      if (meta && inTree(meta.parentId)) {
        read.metas.set(id, meta);
      } else {
        read.metas.delete(id);
      }
    }
    if (added[type]?.length) {
      for (const meta of await database.find<RequestMeta | GrpcRequestMeta>(type, { parentId: { $in: added[type] } })) {
        read.metas.set(meta._id, meta);
      }
    }
  }
  const folderMetaIds = changed(models.requestGroupMeta.type);
  const foundFolderMetas = await fetch<RequestGroupMeta>(models.requestGroupMeta.type, folderMetaIds);
  for (const id of folderMetaIds) {
    const meta = foundFolderMetas.get(id);
    if (meta && previous.parentIds.has(meta.parentId)) {
      read.folderMetas.set(id, meta);
    } else {
      read.folderMetas.delete(id);
    }
  }
  return read;
}

function groupBy<T>(items: T[], key: (item: T) => string | null) {
  const map = new Map<string | null, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) {
      list.push(item);
    } else {
      map.set(k, [item]);
    }
  }
  return map;
}

// the first of each key, as find() gave it
function firstBy<T>(items: T[], key: (item: T) => string | null) {
  const map = new Map<string | null, T>();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) {
      map.set(k, item);
    }
  }
  return map;
}

const WorkspaceRoute = () => {
  const workspaceData = useLoaderData() as WorkspaceLoaderData;
  const branch = workspaceData.activeWorkspaceMeta.cachedGitRepositoryBranch;
  return <Outlet key={branch} />;
};

export default WorkspaceRoute;
