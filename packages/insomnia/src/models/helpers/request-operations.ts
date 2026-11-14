import { GrpcRequest, isGrpcRequest, isGrpcRequestId } from '../grpc-request';
import * as models from '../index';
import { isMcpRequest, isMcpRequestId, McpRequest } from '../mcp-request';
import { Request } from '../request';
import { isWebSocketRequest, isWebSocketRequestId, WebSocketRequest } from '../websocket-request';

/** Any of the request documents: HTTP, gRPC, WebSocket or MCP. */
export type AnyRequest = Request | GrpcRequest | WebSocketRequest | McpRequest;

interface RequestModel<T> {
  update(request: T, patch?: Partial<T>): Promise<T>;
  duplicate(request: T, patch?: Partial<T>): Promise<T>;
}

// The model for a document, by its type; anything else is taken as an HTTP
// request. Built on each call, since the models import this module in turn.
function modelFor<T>(request: T): RequestModel<T> {
  const byType: Record<string, RequestModel<any> | undefined> = {
    [models.grpcRequest.type]: models.grpcRequest,
    [models.webSocketRequest.type]: models.webSocketRequest,
    [models.mcpRequest.type]: models.mcpRequest,
  };
  return byType[(request as { type?: string }).type ?? ''] ?? models.request;
}

export function getById(requestId: string): Promise<AnyRequest | null> {
  if (isGrpcRequestId(requestId)) {
    return models.grpcRequest.getById(requestId);
  }
  if (isMcpRequestId(requestId)) {
    return models.mcpRequest.getById(requestId);
  }
  if (isWebSocketRequestId(requestId)) {
    return models.webSocketRequest.getById(requestId);
  }
  return models.request.getById(requestId);
}

export function remove(request: AnyRequest) {
  if (isGrpcRequest(request)) {
    return models.grpcRequest.remove(request);
  }
  if (isMcpRequest(request)) {
    return models.mcpRequest.remove(request);
  }
  if (isWebSocketRequest(request)) {
    return models.webSocketRequest.remove(request);
  }
  return models.request.remove(request);
}

export function update<T extends object>(request: T, patch: Partial<T> = {}): Promise<T> {
  return modelFor(request).update(request, patch);
}

export function duplicate<T extends object>(request: T, patch: Partial<T> = {}): Promise<T> {
  return modelFor(request).duplicate(request, patch);
}
