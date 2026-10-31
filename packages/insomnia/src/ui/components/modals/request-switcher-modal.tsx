import React, { useEffect, useMemo, useRef, useState } from 'react';
import { OverlayContainer } from 'react-aria';
import { useNavigate, useParams, useRouteLoaderData } from 'react-router-dom';

import { ACTIVITY_DEBUG, ACTIVITY_SPEC } from '../../../common/constants';
import { database } from '../../../common/database';
import { fuzzyMatchAll } from '../../../common/misc';
import * as models from '../../../models';
import { isGrpcRequest } from '../../../models/grpc-request';
import { isMcpRequest } from '../../../models/mcp-request';
import { isRequest } from '../../../models/request';
import { isRequestGroup } from '../../../models/request-group';
import { isWebSocketRequest } from '../../../models/websocket-request';
import { isDesign, type Workspace } from '../../../models/workspace';
import { WorkspaceLoaderData } from '../../routes/workspace';
import { Modal, type ModalHandle } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalHeader } from '../base/modal-header';
import { getMethodShortHand } from '../tags/method-tag';

interface Props {
  // 'recent' orders requests by when they were last opened and starts on the
  // previous one, so Ctrl+Tab then Enter goes back
  mode: 'all' | 'recent';
  onHide: () => void;
}

export const RequestSwitcherModal = ({ mode, onHide }: Props) => {
  const modalRef = useRef<ModalHandle>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();
  const { organizationId, projectId, workspaceId, requestId } = useParams() as {
    organizationId: string;
    projectId: string;
    workspaceId: string;
    requestId?: string;
  };
  const { collection } = useRouteLoaderData(':workspaceId') as WorkspaceLoaderData;
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(0);
  const [lastActive, setLastActive] = useState<Record<string, number> | null>(null);
  // the project's other collections, to jump to as well
  const [collections, setCollections] = useState<Workspace[]>([]);

  useEffect(() => {
    if (mode !== 'all') {
      return;
    }
    models.workspace.findByParentId(projectId).then(workspaces => setCollections(workspaces.filter(workspace => workspace._id !== workspaceId)));
  }, [mode, projectId, workspaceId]);

  useEffect(() => {
    modalRef.current?.show();
  }, []);

  const requests = useMemo(() => {
    const folderNames = new Map(collection.filter(({ doc }) => isRequestGroup(doc)).map(({ doc }) => [doc._id, doc.name]));
    return collection.flatMap(({ doc, ancestors = [] }) => isRequestGroup(doc) ? [] : [{
      doc,
      folder: ancestors.map(id => folderNames.get(id)).filter(Boolean).join(' / '),
    }]);
  }, [collection]);

  useEffect(() => {
    if (mode !== 'recent') {
      return;
    }
    const parentId = { $in: requests.map(({ doc }) => doc._id) };
    Promise.all([
      database.find(models.requestMeta.type, { parentId }),
      database.find(models.grpcRequestMeta.type, { parentId }),
    ]).then(metas => {
      setLastActive(Object.fromEntries(metas.flat().map(meta => [meta.parentId, (meta as { lastActive?: number }).lastActive || 0])));
    });
  }, [mode, requests]);

  const matches = useMemo(() => {
    if (filter.trim()) {
      // every word has to match, best match first (ties keep sidebar order)
      return requests
        .flatMap(entry => {
          const match = fuzzyMatchAll(filter, [entry.doc.name, entry.folder, entry.doc.url], { splitSpace: true });
          return match ? [{ ...entry, score: match.score }] : [];
        })
        .sort((a, b) => b.score - a.score);
    }
    if (mode === 'recent' && lastActive) {
      return [...requests].sort((a, b) => (lastActive[b.doc._id] || 0) - (lastActive[a.doc._id] || 0));
    }
    return requests;
  }, [requests, filter, mode, lastActive]);

  const collectionMatches = useMemo(() => {
    if (!filter.trim()) {
      return collections;
    }
    return collections
      .flatMap(workspace => {
        const match = fuzzyMatchAll(filter, [workspace.name], { splitSpace: true });
        return match ? [{ workspace, score: match.score }] : [];
      })
      .sort((a, b) => b.score - a.score)
      .map(({ workspace }) => workspace);
  }, [collections, filter]);
  const count = matches.length + collectionMatches.length;

  useEffect(() => {
    setSelected(mode === 'recent' && !filter && matches[0]?.doc._id === requestId && matches.length > 1 ? 1 : 0);
    // only when the list is (re)built, not when the selection moves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  useEffect(() => {
    listRef.current?.querySelectorAll('[role="option"]')[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const open = (id: string) => {
    modalRef.current?.hide();
    navigate(`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/debug/request/${id}`);
  };
  const openCollection = (workspace: Workspace) => {
    modalRef.current?.hide();
    navigate(`/organization/${organizationId}/project/${projectId}/workspace/${workspace._id}/${isDesign(workspace) ? ACTIVITY_SPEC : ACTIVITY_DEBUG}`);
  };
  const openSelected = () => {
    if (selected < matches.length) {
      open(matches[selected].doc._id);
    } else if (collectionMatches[selected - matches.length]) {
      openCollection(collectionMatches[selected - matches.length]);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const move = (by: number) => {
      event.preventDefault();
      setSelected(index => Math.min(Math.max(index + by, 0), count - 1));
    };
    if (event.key === 'ArrowDown' || (event.key === 'Tab' && event.ctrlKey && !event.shiftKey)) {
      move(1);
    } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.ctrlKey && event.shiftKey)) {
      move(-1);
    } else if (event.key === 'Enter' && selected < count) {
      event.preventDefault();
      openSelected();
    }
  };

  return (
    <OverlayContainer>
      <Modal ref={modalRef} onHide={onHide}>
        <ModalHeader>{mode === 'recent' ? 'Recent Requests' : 'Switch Request'}</ModalHeader>
        <ModalBody className="pad">
          <div className="form-control form-control--outlined">
            <input
              autoFocus
              aria-label="Filter requests"
              placeholder="Filter by name, folder or URL"
              value={filter}
              onChange={event => setFilter(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <ul ref={listRef} role="listbox" aria-label="Requests" className="max-h-[50vh] overflow-y-auto m-0 p-0 list-none">
            {matches.map(({ doc, folder }, index) => (
              <li
                key={doc._id}
                role="option"
                aria-selected={index === selected}
                className={`flex items-center gap-2 px-[--padding-sm] py-1 cursor-pointer rounded-sm ${index === selected ? 'bg-[--hl-sm]' : ''}`}
                onMouseMove={() => setSelected(index)}
                onClick={() => open(doc._id)}
              >
                {/* the tags the sidebar shows */}
                {isRequest(doc) && (
                  <span className={`w-10 flex-shrink-0 flex text-[0.65rem] rounded-sm border border-solid border-[--hl-sm] items-center justify-center http-method-${doc.method}`}>
                    {getMethodShortHand(doc)}
                  </span>
                )}
                {isWebSocketRequest(doc) && (
                  <span className="w-10 flex-shrink-0 flex text-[0.65rem] rounded-sm border border-solid border-[--hl-sm] items-center info justify-center">
                    WS
                  </span>
                )}
                {isMcpRequest(doc) && (
                  <span className="w-10 flex-shrink-0 flex text-[0.65rem] rounded-sm border border-solid border-[--hl-sm] items-center success justify-center">
                    MCP
                  </span>
                )}
                {isGrpcRequest(doc) && (
                  <span className="w-10 flex-shrink-0 flex text-[0.65rem] rounded-sm border border-solid border-[--hl-sm] items-center method-grpc justify-center">
                    gRPC
                  </span>
                )}
                <span className="truncate">{doc.name || doc.url || 'Untitled request'}</span>
                {folder && <span className="truncate faint text-sm ml-auto">{folder}</span>}
              </li>
            ))}
            {collectionMatches.length > 0 && (
              <li role="presentation" className="px-[--padding-sm] pt-[--padding-sm] pb-1 text-xs uppercase faint">
                Collections
              </li>
            )}
            {collectionMatches.map((workspace, index) => (
              <li
                key={workspace._id}
                role="option"
                aria-selected={matches.length + index === selected}
                className={`flex items-center gap-2 px-[--padding-sm] py-1 cursor-pointer rounded-sm ${matches.length + index === selected ? 'bg-[--hl-sm]' : ''}`}
                onMouseMove={() => setSelected(matches.length + index)}
                onClick={() => openCollection(workspace)}
              >
                <span className="w-10 flex-shrink-0 flex text-[0.65rem] rounded-sm border border-solid border-[--hl-sm] items-center justify-center faint">
                  {isDesign(workspace) ? 'DOC' : 'COL'}
                </span>
                <span className="truncate">{workspace.name}</span>
              </li>
            ))}
          </ul>
          {!count && <p className="faint">No requests match.</p>}
        </ModalBody>
      </Modal>
    </OverlayContainer>
  );
};
