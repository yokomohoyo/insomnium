import { OverlayContainer } from '@react-aria/overlays';
import React, { FC, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { HistoryEntry, recentHistory } from '../../../common/history';
import { fuzzyMatchAll } from '../../../common/misc';
import * as models from '../../../models';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalHeader } from '../base/modal-header';
import { StatusTag } from '../tags/status-tag';
import { TimeFromNow } from '../time-from-now';

// Every collection's latest responses, newest first: open one to see it with
// its request
export const HistoryModal: FC<ModalProps> = ({ onHide }) => {
  const modalRef = useRef<ModalHandle>(null);
  const navigate = useNavigate();
  const { organizationId } = useParams() as { organizationId: string };
  const [entries, setEntries] = useState<HistoryEntry[]>();
  const [filter, setFilter] = useState('');

  useEffect(() => {
    modalRef.current?.show();
    recentHistory().then(setEntries);
  }, []);

  const matches = useMemo(() => (entries || []).filter(({ response, request, workspace, folders }) =>
    !filter.trim() || fuzzyMatchAll(filter, [request.name, response.url || request.url, workspace.name, ...folders], { splitSpace: true })),
  [entries, filter]);

  const open = async ({ response, request, workspace }: HistoryEntry) => {
    await models.requestMeta.updateOrCreateByParentId(request._id, { activeResponseId: response._id });
    modalRef.current?.hide();
    navigate(`/organization/${organizationId}/project/${workspace.parentId}/workspace/${workspace._id}/debug/request/${request._id}`);
  };

  return (
    <OverlayContainer>
      <Modal ref={modalRef} onHide={onHide} wide>
        <ModalHeader>History</ModalHeader>
        <ModalBody className="pad">
          <div className="form-control form-control--outlined">
            <input
              autoFocus
              aria-label="Filter history"
              placeholder="Filter by request, URL, folder or collection"
              value={filter}
              onChange={event => setFilter(event.target.value)}
            />
          </div>
          <ul aria-label="Responses" className="max-h-[60vh] overflow-y-auto m-0 p-0 list-none">
            {matches.map(entry => {
              const { response, request, workspace, folders } = entry;
              return (
                <li key={response._id}>
                  <button
                    className="flex w-full items-center gap-2 px-[--padding-sm] py-1 rounded-sm hover:bg-[--hl-sm] text-left"
                    onClick={() => open(entry)}
                  >
                    <span className={`w-12 flex-shrink-0 text-[0.65rem] http-method-${request.method}`}>{request.method}</span>
                    {response.error ? <StatusTag small statusCode={0} statusMessage="Error" /> : <StatusTag small statusCode={response.statusCode} statusMessage={response.statusMessage} />}
                    <span className="truncate flex-1" title={response.url || request.url}>{response.url || request.url}</span>
                    <span className="truncate faint text-sm">{[workspace.name, ...folders, request.name].join(' / ')}</span>
                    <TimeFromNow className="faint text-sm flex-shrink-0" timestamp={response.created} />
                  </button>
                </li>
              );
            })}
          </ul>
          {entries && !matches.length && <p className="faint">{entries.length ? 'No responses match.' : 'Nothing has been sent yet.'}</p>}
        </ModalBody>
      </Modal>
    </OverlayContainer>
  );
};
