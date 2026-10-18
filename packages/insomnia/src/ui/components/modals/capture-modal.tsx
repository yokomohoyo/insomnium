import React, { FC, useCallback, useEffect, useRef, useState } from 'react';

import type { CapturedExchange } from '../../../main/capture-proxy';
import * as models from '../../../models';
import type { Workspace } from '../../../models/workspace';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';

const DEFAULT_PORT = 8899;
// set by the request as it's sent, not kept with it
const LEFT_OUT = new Set(['host', 'content-length']);

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// an exchange as a request in the collection: its method, URL, headers and body
export async function saveExchange(exchange: CapturedExchange, parentId: string) {
  const url = new URL(exchange.url);
  const contentType = exchange.requestHeaders.find(({ name }) => name.toLowerCase() === 'content-type')?.value;
  return models.request.create({
    parentId,
    name: `${exchange.method} ${url.pathname}`,
    method: exchange.method,
    url: exchange.url,
    headers: exchange.requestHeaders.filter(({ name }) => !LEFT_OUT.has(name.toLowerCase())),
    body: exchange.requestBody ? { mimeType: contentType || 'text/plain', text: exchange.requestBody } : {},
  });
}

// Capture: a proxy on this computer that records what's sent through it
// (main/capture-proxy.ts), to keep as requests in this collection
export const CaptureModal: FC<ModalProps & { workspace: Workspace }> = ({ workspace, onHide }) => {
  const modalRef = useRef<ModalHandle>(null);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [listening, setListening] = useState<number | null>(null);
  const [exchanges, setExchanges] = useState<CapturedExchange[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const refresh = useCallback(async () => {
    setExchanges(await window.main.capture.list());
    setListening(await window.main.capture.status());
  }, []);

  useEffect(() => {
    modalRef.current?.show();
    refresh();
    return window.main.on('capture.changed', () => refresh());
  }, [refresh]);

  const start = async () => {
    setError('');
    try {
      setListening(await window.main.capture.start({ port }));
    } catch (err) {
      setError(`Couldn't listen on port ${port}: ${errorText(err)}`);
    }
  };
  const stop = async () => {
    await window.main.capture.stop();
    setListening(null);
  };
  const save = async (toSave: CapturedExchange[]) => {
    for (const summary of toSave) {
      // the list leaves the bodies out
      await saveExchange(await window.main.capture.get({ id: summary.id }) || summary, workspace._id);
    }
    setSaved(`Saved ${toSave.length} ${toSave.length === 1 ? 'request' : 'requests'} to ${workspace.name}.`);
    setChosen(new Set());
  };

  const savable = exchanges.filter(exchange => !exchange.tunnel);
  const newestFirst = [...exchanges].reverse();

  return (
    <Modal ref={modalRef} onHide={onHide} wide tall>
      <ModalHeader>Capture Traffic</ModalHeader>
      <ModalBody className="pad">
        <p className="faint txt-sm no-margin-top">
          A proxy on this computer that records the requests an app, a script or a browser sends through it, to keep as requests in {workspace.name}.
          Plain HTTP is recorded in full. HTTPS goes through untouched and is listed by host only: to keep HTTPS requests, save them as a HAR file from a browser&apos;s devtools, and import it.
        </p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            Port
            <input type="number" aria-label="Capture port" min={1024} max={65535} value={port} disabled={listening !== null} onChange={event => setPort(Number(event.currentTarget.value) || DEFAULT_PORT)} />
          </label>
          {listening === null
            ? <button className="btn btn--clicky" onClick={start}>Start Capturing</button>
            : <button className="btn btn--clicky" onClick={stop}>Stop</button>}
          <button className="btn btn--compact" disabled={!exchanges.length} onClick={() => window.main.capture.clear().then(refresh)}>Clear</button>
        </div>
        {listening !== null && (
          <p className="notice info selectable" data-testid="capture-status">
            Capturing on 127.0.0.1:{listening}. Set it as the HTTP proxy, such as <code>HTTP_PROXY=http://127.0.0.1:{listening}</code>, or <code>curl -x http://127.0.0.1:{listening} http://…</code>
          </p>
        )}
        {error && <p className="notice error">{error}</p>}
        {saved && <p className="notice success">{saved}</p>}
        <table className="table--fancy table--striped margin-top" aria-label="Captured requests">
          <thead>
            <tr>
              <th />
              <th>Request</th>
              <th className="text-right">Status</th>
              <th className="text-right">Time</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {newestFirst.length === 0 && (
              <tr><td colSpan={5} className="faint">Nothing captured yet.</td></tr>
            )}
            {newestFirst.map(exchange => (
              <tr key={exchange.id} aria-label={`${exchange.method} ${exchange.url}`}>
                <td>
                  {!exchange.tunnel && (
                    <input
                      type="checkbox"
                      aria-label="Choose"
                      checked={chosen.has(exchange.id)}
                      onChange={event => {
                        const next = new Set(chosen);
                        event.currentTarget.checked ? next.add(exchange.id) : next.delete(exchange.id);
                        setChosen(next);
                      }}
                    />
                  )}
                </td>
                <td className="selectable">
                  <span className="monospace faint">{exchange.method}</span> {exchange.tunnel ? <span className="faint">{exchange.tunnel}, HTTPS (not read)</span> : exchange.url}
                  {exchange.error && <div className="danger txt-sm">{exchange.error}</div>}
                  {exchange.truncated && <div className="faint txt-sm">Bodies over 1 MB are cut short.</div>}
                </td>
                <td className="text-right">{exchange.statusCode ?? '…'}</td>
                <td className="text-right">{exchange.elapsedMs === undefined ? '' : `${exchange.elapsedMs} ms`}</td>
                <td className="text-right">
                  {!exchange.tunnel && <button className="btn btn--super-compact" onClick={() => save([exchange])}>Save</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ModalBody>
      <ModalFooter>
        <div className="margin-left faint txt-sm">{exchanges.length} captured; the latest 500 are kept while the app runs</div>
        <div>
          <button className="btn" disabled={!chosen.size} onClick={() => save(savable.filter(exchange => chosen.has(exchange.id)))}>
            Save {chosen.size || ''} as Requests
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
};
