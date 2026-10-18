import React, { FC, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useRouteLoaderData } from 'react-router-dom';

import { neighborOf, withoutTab, withTab } from '../../common/open-tabs';
import { isGrpcRequest } from '../../models/grpc-request';
import * as models from '../../models/index';
import { isMcpRequest } from '../../models/mcp-request';
import { isRequest } from '../../models/request';
import { isRequestGroup } from '../../models/request-group';
import { isWebSocketRequest } from '../../models/websocket-request';
import { WorkspaceLoaderData } from '../routes/workspace';
import { getMethodShortHand } from './tags/method-tag';

// The requests open in this workspace, as tabs over the request and response:
// opening one from the sidebar adds its tab, and a tab's × (or a middle click)
// closes it. They're kept in the WorkspaceMeta, on this computer.
export const RequestTabs: FC = () => {
  const { organizationId, projectId, workspaceId, requestId } = useParams() as {
    organizationId: string;
    projectId: string;
    workspaceId: string;
    requestId?: string;
  };
  const { activeWorkspaceMeta, collection } = useRouteLoaderData(':workspaceId') as WorkspaceLoaderData;
  const navigate = useNavigate();
  // here rather than from the loader, which doesn't run again as requests change
  const [open, setOpen] = useState<string[]>(() => activeWorkspaceMeta?.openRequestIds || []);

  useEffect(() => {
    if (requestId) {
      setOpen(current => withTab(current, requestId));
    }
  }, [requestId]);
  useEffect(() => {
    models.workspaceMeta.updateByParentId(workspaceId, { openRequestIds: open });
  }, [open, workspaceId]);

  const docs = useMemo(() => new Map(collection.map(({ doc }) => [doc._id, doc])), [collection]);
  // a request deleted since has no tab
  const tabs = open.filter(id => docs.has(id) && !isRequestGroup(docs.get(id)!));
  if (!tabs.length) {
    return null;
  }

  const debug = `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/debug`;
  const close = async (id: string) => {
    setOpen(current => withoutTab(current, id));
    if (id !== requestId) {
      return;
    }
    const next = neighborOf(tabs, id);
    if (next) {
      navigate(`${debug}/request/${next}`);
      return;
    }
    // no request then, rather than the one just closed again
    await models.workspaceMeta.updateByParentId(workspaceId, { activeRequestId: null });
    navigate(debug);
  };

  return (
    <nav
      aria-label="Open requests"
      className="flex items-stretch h-[--line-height-sm] overflow-x-auto overflow-y-hidden border-b border-solid border-[--hl-md] bg-[--color-bg]"
    >
      {tabs.map(id => {
        const doc = docs.get(id)!;
        const name = isRequestGroup(doc) ? doc.name : doc.name || ('url' in doc ? doc.url : '') || 'Untitled request';
        const active = id === requestId;
        return (
          <div
            key={id}
            data-testid="request-tab"
            aria-current={active ? 'page' : undefined}
            className={`group flex flex-shrink-0 items-center gap-1 max-w-[14rem] pl-3 pr-1 border-r border-solid border-[--hl-sm] text-[--font-size-sm] ${active ? 'bg-[--hl-xs] text-[--color-font]' : 'text-[--hl]'}`}
            onMouseDown={event => {
              if (event.button === 1) {
                event.preventDefault();
                close(id);
              }
            }}
          >
            <Link to={`${debug}/request/${id}`} title={name} className="flex items-center gap-2 min-w-0 no-underline text-inherit">
              {isRequest(doc) && <span className={`text-[0.65rem] http-method-${doc.method}`}>{getMethodShortHand(doc)}</span>}
              {isWebSocketRequest(doc) && <span className="text-[0.65rem] info">WS</span>}
              {isMcpRequest(doc) && <span className="text-[0.65rem] success">MCP</span>}
              {isGrpcRequest(doc) && <span className="text-[0.65rem] method-grpc">gRPC</span>}
              <span className="truncate">{name}</span>
            </Link>
            <button
              aria-label={`Close ${name}`}
              className={`flex items-center justify-center w-5 h-5 rounded-sm hover:bg-[--hl-sm] ${active ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
              onClick={() => close(id)}
            >
              <i className="fa fa-xmark" />
            </button>
          </div>
        );
      })}
    </nav>
  );
};
