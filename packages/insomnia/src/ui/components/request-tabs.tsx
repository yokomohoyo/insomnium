import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
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
  const { collection } = useRouteLoaderData(':workspaceId') as WorkspaceLoaderData;
  const navigate = useNavigate();
  // here, from the database, rather than the loader's: that doesn't run again as
  // requests change, nor between debug, spec and test, so its list is old by the
  // time this mounts again. Kept with its workspace, so it's saved to that one
  const [loaded, setLoaded] = useState<{ workspaceId: string; ids: string[] }>();
  const open = loaded?.workspaceId === workspaceId ? loaded.ids : undefined;

  useEffect(() => {
    let current = true;
    models.workspaceMeta.getOrCreateByParentId(workspaceId).then(meta => {
      if (current) {
        setLoaded({ workspaceId, ids: meta.openRequestIds || [] });
      }
    });
    return () => {
      current = false;
    };
  }, [workspaceId]);
  // a request gets its tab as it opens (or once the list has loaded), not again
  // as the list changes: one just closed is still open until the navigation lands
  const added = useRef<string>();
  useEffect(() => {
    if (!requestId) {
      added.current = undefined;
    } else if (open && added.current !== requestId) {
      added.current = requestId;
      setLoaded(current => {
        if (!current) {
          return current;
        }
        const ids = withTab(current.ids, requestId);
        return ids === current.ids ? current : { ...current, ids };
      });
    }
  }, [open, requestId]);
  useEffect(() => {
    if (loaded) {
      models.workspaceMeta.updateByParentId(loaded.workspaceId, { openRequestIds: loaded.ids });
    }
  }, [loaded]);

  const docs = useMemo(() => new Map(collection.map(({ doc }) => [doc._id, doc])), [collection]);
  // a request deleted since has no tab
  const tabs = (open || []).filter(id => docs.has(id) && !isRequestGroup(docs.get(id)!));
  if (!tabs.length) {
    return null;
  }

  const debug = `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/debug`;
  const close = async (id: string) => {
    setLoaded(current => current && { ...current, ids: withoutTab(current.ids, id) });
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
