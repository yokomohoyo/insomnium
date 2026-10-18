import { OverlayContainer } from '@react-aria/overlays';
import React, { FC, useEffect, useRef, useState } from 'react';

import type { MockServerStatus } from '../../../main/mock-servers';
import { loadMockRoutes, type MockLogEntry, mockPathOf, type MockRoute } from '../../../mock/mock-routes';
import type { Workspace } from '../../../models/workspace';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';

const DEFAULT_PORT = 4040;
const MAX_LOG = 100;

// A collection's local mock server: it answers with the requests' examples
export const MockServerModal: FC<ModalProps & { workspace: Workspace }> = ({ workspace, onHide }) => {
  const modalRef = useRef<ModalHandle>(null);
  const [status, setStatus] = useState<MockServerStatus | null>(null);
  const [routes, setRoutes] = useState<MockRoute[]>();
  const [port, setPort] = useState(DEFAULT_PORT);
  const [log, setLog] = useState<MockLogEntry[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    modalRef.current?.show();
    window.main.mockServer.status(workspace._id).then(setStatus);
    loadMockRoutes(workspace).then(setRoutes);
  }, [workspace]);

  useEffect(() => window.main.on('mockServer.request', (_, workspaceId: string, entry: MockLogEntry) => {
    if (workspaceId === workspace._id) {
      setLog(entries => [entry, ...entries].slice(0, MAX_LOG));
    }
  }), [workspace._id]);

  const start = async () => {
    setError('');
    try {
      setStatus(await window.main.mockServer.start({ workspaceId: workspace._id, port }));
      setRoutes(await loadMockRoutes(workspace));
    } catch (err) {
      setError(/EADDRINUSE/.test(String(err)) ? `Port ${port} is in use: choose another.` : String((err as Error).message || err));
    }
  };

  const stop = async () => {
    await window.main.mockServer.stop(workspace._id);
    setStatus(null);
  };

  return (
    <OverlayContainer>
      <Modal ref={modalRef} onHide={onHide} wide tall>
        <ModalHeader>Mock Server</ModalHeader>
        <ModalBody className="pad">
          <p className="faint txt-sm no-margin-top">
            Answers as {workspace.name}&apos;s requests would, with their examples. A request matches by method and path, in which <code>:params</code> and <code>{'{{ variables }}'}</code> match anything.
            The headers <code>x-mock-response-name</code> or <code>x-mock-response-code</code> choose an example; otherwise the first 2xx one answers. It listens on this computer only.
          </p>
          <div className="flex items-center gap-2">
            {status ? (
              <>
                <span>Running at <strong className="selectable" data-testid="mock-server-url">{status.url}</strong></span>
                <button className="btn btn--clicky" onClick={() => window.clipboard.writeText(status.url)}>Copy URL</button>
                <button className="btn btn--clicky" onClick={stop}>Stop</button>
              </>
            ) : (
              <>
                <label className="flex items-center gap-2">
                  Port
                  <input className="w-24" type="number" min={0} max={65535} aria-label="Port" value={port} onChange={event => setPort(Number(event.currentTarget.value) || 0)} />
                </label>
                <button className="btn btn--clicky" onClick={start}>Start</button>
              </>
            )}
          </div>
          {error && <p className="notice error">{error}</p>}

          <h2 className="txt-md">Routes</h2>
          {routes && !routes.length && <p className="faint">No request has an example yet: save one from a response with Save as Example, or add one in a request&apos;s Examples tab.</p>}
          <ul aria-label="Mocked routes" className="list-none m-0 p-0">
            {(routes || []).map(({ request, examples }) => (
              <li key={request._id} className="flex gap-2 py-1">
                <span className={`w-14 flex-shrink-0 http-method-${request.method}`}>{request.method}</span>
                <span className="selectable">{mockPathOf(request.url)}</span>
                <span className="faint">{request.name} · {examples.map(example => `${example.statusCode} ${example.name}`).join(', ')}</span>
              </li>
            ))}
          </ul>

          <h2 className="txt-md">Requests</h2>
          {!log.length && <p className="faint">{status ? 'None yet.' : 'Start the server to see the requests it answers.'}</p>}
          <ul aria-label="Mock requests" className="list-none m-0 p-0 txt-sm">
            {log.map(entry => (
              <li key={`${entry.time}-${entry.method}-${entry.path}`} className="flex gap-2 py-1">
                <span className="faint">{new Date(entry.time).toLocaleTimeString()}</span>
                <span className="w-14 flex-shrink-0">{entry.method}</span>
                <span className="selectable">{entry.path}</span>
                <span className={entry.status >= 400 ? 'danger' : 'success'}>{entry.status}</span>
                <span className="faint">{entry.exampleName ? `${entry.requestName} · ${entry.exampleName}` : entry.note}</span>
              </li>
            ))}
          </ul>
        </ModalBody>
        <ModalFooter>
          <button className="btn" onClick={() => modalRef.current?.hide()}>Close</button>
        </ModalFooter>
      </Modal>
    </OverlayContainer>
  );
};
