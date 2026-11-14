
import { useFetcher, useParams } from 'react-router-dom';

import { GrpcRequest } from '../../models/grpc-request';
import { GrpcRequestMeta } from '../../models/grpc-request-meta';
import type { McpRequest } from '../../models/mcp-request';
import { Request } from '../../models/request';
import { RequestGroup } from '../../models/request-group';
import { RequestGroupMeta } from '../../models/request-group-meta';
import { RequestMeta } from '../../models/request-meta';
import { Settings } from '../../models/settings';
import { WebSocketRequest } from '../../models/websocket-request';
import { WorkspaceMeta } from '../../models/workspace-meta';
import { trackSave } from '../pending-edits';
import { requestGroupPath, requestPath, workspacePath } from '../routes/paths';

export const useRequestSetter = () => {
  const { organizationId, projectId, workspaceId } = useParams<{ organizationId: string; projectId: string; workspaceId: string }>();
  const fetcher = useFetcher();
  return (requestId: string, patch: Partial<GrpcRequest> | Partial<Request> | Partial<WebSocketRequest> | Partial<McpRequest>) => {
    trackSave(fetcher.submit(JSON.stringify(patch), {
      action: requestPath({ organizationId, projectId, workspaceId }, requestId, 'update'),
      method: 'post',
      encType: 'application/json',
    }));
  };
};

export const useRequestMetaPatcher = () => {
  const { organizationId, projectId, workspaceId } = useParams<{ organizationId: string; projectId: string; workspaceId: string }>();
  const fetcher = useFetcher();
  return (requestId: string, patch: Partial<GrpcRequestMeta> | Partial<RequestMeta>) => {
    fetcher.submit(patch, {
      action: requestPath({ organizationId, projectId, workspaceId }, requestId, 'update-meta'),
      method: 'post',
      encType: 'application/json',
    });
  };
};

export const useRequestGroupPatcher = () => {
  const { organizationId, projectId, workspaceId } = useParams<{ organizationId: string; projectId: string; workspaceId: string }>();
  const fetcher = useFetcher();
  return (requestGroupId: string, patch: Partial<RequestGroup>) => {
    fetcher.submit(JSON.stringify(patch), {
      action: requestGroupPath({ organizationId, projectId, workspaceId }, requestGroupId, 'update'),
      method: 'post',
      encType: 'application/json',
    });
  };
};

export const useRequestGroupMetaPatcher = () => {
  const { organizationId, projectId, workspaceId } = useParams<{ organizationId: string; projectId: string; workspaceId: string }>();
  const fetcher = useFetcher();
  return (requestGroupId: string, patch: Partial<RequestGroupMeta>) => {
    fetcher.submit(patch, {
      action: requestGroupPath({ organizationId, projectId, workspaceId }, requestGroupId, 'update-meta'),
      method: 'post',
      encType: 'application/json',
    });
  };
};

export const useSettingsPatcher = () => {
  const fetcher = useFetcher();
  return (patch: Partial<Settings>) => {
    fetcher.submit(JSON.stringify(patch), {
      action: '/settings/update',
      method: 'post',
      encType: 'application/json',
    });
  };
};

export const useWorkspaceMetaPatcher = () => {
  const { organizationId, projectId } = useParams<{ organizationId: string; projectId: string }>();
  const fetcher = useFetcher();
  return (workspaceId: string, patch: Partial<WorkspaceMeta>) => {
    fetcher.submit(patch, {
      action: workspacePath({ organizationId, projectId, workspaceId }, 'update-meta'),
      method: 'post',
      encType: 'application/json',
    });
  };
};

export type CreateRequestType = 'HTTP' | 'gRPC' | 'GraphQL' | 'WebSocket' | 'MCP' | 'Event Stream' | 'LLM' | 'From Curl';
