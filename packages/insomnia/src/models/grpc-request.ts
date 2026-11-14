import { database as db } from '../common/database';
import { duplicateAfter } from './helpers/duplicate-after';
import type { BaseModel } from './index';
import type { RequestAuthentication } from './request';

export const name = 'gRPC Request';
export const type = 'GrpcRequest';
export const prefix = 'greq';
export const canDuplicate = true;
export const canSync = true;

export interface GrpcRequestBody {
  text?: string;
}

export interface GrpcRequestHeader {
  name: string;
  value: string;
  description?: string;
  disabled?: boolean;
}

interface BaseGrpcRequest {
  name: string;
  url: string;
  description: string;
  protoFileId?: string;
  protoMethodName?: string;
  body: GrpcRequestBody;
  metadata: GrpcRequestHeader[];
  authentication: RequestAuthentication;
  metaSortKey: number;
  isPrivate: boolean;
}

export type GrpcRequest = BaseModel & BaseGrpcRequest;

export const isGrpcRequest = (model: Pick<BaseModel, 'type'>): model is GrpcRequest => (
  model.type === type
);

export const isGrpcRequestId = (id: string | null) => (
  id?.startsWith(`${prefix}_`)
);

export function init(): BaseGrpcRequest {
  return {
    url: '',
    name: 'New gRPC Request',
    description: '',
    protoFileId: '',
    protoMethodName: '',
    metadata: [],
    authentication: [],
    body: {
      text: '{}',
    },
    metaSortKey: -1 * Date.now(),
    isPrivate: false,
  };
}

export function migrate(doc: GrpcRequest) {
  // Multi-auth: read-time wrap legacy missing/object-shaped authentication as [].
  const auth = (doc as any).authentication;
  if (!auth) {
    (doc as any).authentication = [];
  } else if (!Array.isArray(auth)) {
    (doc as any).authentication = Object.keys(auth).length === 0 ? [] : [auth];
  }
  return doc;
}

export function create(patch: Partial<GrpcRequest> = {}) {
  if (!patch.parentId) {
    throw new Error('New GrpcRequest missing `parentId`');
  }

  return db.docCreate<GrpcRequest>(type, patch);
}

export function remove(obj: GrpcRequest) {
  return db.remove(obj);
}

export function update(obj: GrpcRequest, patch: Partial<GrpcRequest> = {}) {
  return db.docUpdate(obj, patch);
}

export function getById(_id: string) {
  return db.getWhere<GrpcRequest>(type, { _id });
}

export function findByProtoFileId(protoFileId: string) {
  return db.find<GrpcRequest>(type, { protoFileId });
}

export function findByParentId(parentId: string) {
  return db.find<GrpcRequest>(type, { parentId });
}

export async function duplicate(request: GrpcRequest, patch: Partial<GrpcRequest> = {}) {
  // Only set name and "(Copy)" if the patch does
  // not define it and the request itself has a name.
  // Otherwise leave it blank so the request URL can
  // fill it in automatically.
  if (!patch.name && request.name) {
    patch.name = `${request.name} (Copy)`;
  }
  return duplicateAfter(type, request, patch);
}

export function all() {
  return db.all<GrpcRequest>(type);
}
