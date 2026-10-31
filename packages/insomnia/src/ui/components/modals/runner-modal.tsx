import fs from 'fs';
import path from 'path';
import React, { FC, useEffect, useRef, useState } from 'react';
import { OverlayContainer } from 'react-aria';
import { useNavigate, useParams, useRouteLoaderData } from 'react-router-dom';

import { jsonReport, junitReport, parseDataFile, resultName } from '../../../network/run-files';
import { listRunnableRequests, RunnableRequest, RunResult, runRequests, RunSummary } from '../../../network/runner';
import { WorkspaceLoaderData } from '../../routes/workspace';
import { LoadTestPanel } from '../load-test-panel';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';
import { AssertionResultsViewer } from '../viewers/assertion-results-viewer';

const elapsed = (ms?: number) => ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

interface Props {
  // the folder or workspace whose requests run
  parentId: string;
  name: string;
  // the folders above the requests, for their names (a folder's own name)
  folders?: string[];
}

// The collection runner: a folder's or the collection's HTTP requests, sent in
// order with their assertions checked, as `insomnium-server run` does in CI
export const RunnerModal: FC<ModalProps & Props> = ({ parentId, name, folders = [], onHide }) => {
  const modalRef = useRef<ModalHandle>(null);
  const navigate = useNavigate();
  const { organizationId, projectId, workspaceId } = useParams() as { organizationId: string; projectId: string; workspaceId: string };
  const { activeEnvironment } = useRouteLoaderData(':workspaceId') as WorkspaceLoaderData;
  const [requests, setRequests] = useState<RunnableRequest[]>();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [iterations, setIterations] = useState(1);
  const [delay, setDelay] = useState(0);
  const [bail, setBail] = useState(false);
  const [data, setData] = useState<{ file: string; rows: Record<string, unknown>[] }>();
  const [error, setError] = useState('');
  const [results, setResults] = useState<RunResult[]>([]);
  const [summary, setSummary] = useState<RunSummary>();
  const [running, setRunning] = useState(false);
  // run them once per iteration, or load test them
  const [mode, setMode] = useState<'run' | 'load'>('run');
  const [loadRunning, setLoadRunning] = useState(false);
  const busy = running || loadRunning;
  const controller = useRef<AbortController>();
  // a stable dependency for the effect, though the array is new each render
  const folderKey = JSON.stringify(folders);

  useEffect(() => {
    modalRef.current?.show();
    listRunnableRequests(parentId, JSON.parse(folderKey)).then(setRequests);
  }, [parentId, folderKey]);

  const chosen = (requests || []).filter(({ request }) => !skipped.has(request._id));

  const run = async () => {
    setError('');
    setResults([]);
    setSummary(undefined);
    setRunning(true);
    controller.current = new AbortController();
    try {
      setSummary(await runRequests(chosen, {
        iterations,
        data: data?.rows,
        delay,
        bail,
        signal: controller.current.signal,
        onResult: result => setResults(current => [...current, result]),
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const chooseData = async () => {
    const { canceled, filePaths } = await window.dialog.showOpenDialog({
      title: 'Data file',
      buttonLabel: 'Use',
      properties: ['openFile'],
      filters: [{ name: 'CSV or JSON', extensions: ['csv', 'json'] }],
    });
    if (canceled || !filePaths[0]) {
      return;
    }
    try {
      const rows = parseDataFile(filePaths[0], await fs.promises.readFile(filePaths[0], 'utf8'));
      setData({ file: filePaths[0], rows });
      setIterations(Math.max(1, rows.length));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const save = async (kind: 'junit' | 'json') => {
    if (!summary) {
      return;
    }
    const { canceled, filePath } = await window.dialog.showSaveDialog({
      title: kind === 'junit' ? 'Save JUnit report' : 'Save JSON report',
      buttonLabel: 'Save',
      defaultPath: `${name.replace(/[\\/:*?"<>|]/g, '-')}-run.${kind === 'junit' ? 'xml' : 'json'}`,
    });
    if (canceled || !filePath) {
      return;
    }
    await fs.promises.writeFile(filePath, kind === 'junit' ? junitReport(summary, name) : jsonReport(summary, name));
  };

  const openRequest = (requestId: string) => {
    modalRef.current?.hide();
    navigate(`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/debug/request/${requestId}`);
  };

  const passed = results.filter(result => result.passed).length;
  // closing the runner stops the run
  const hide = () => {
    controller.current?.abort();
    onHide?.();
  };

  return (
    <OverlayContainer onClick={e => e.stopPropagation()}>
      <Modal ref={modalRef} onHide={hide} wide tall>
        <ModalHeader>Run {name}</ModalHeader>
        <ModalBody className="pad">
          <div role="radiogroup" aria-label="Runner mode" className="flex gap-4 margin-bottom-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="runner-mode" checked={mode === 'run'} disabled={busy} onChange={() => setMode('run')} />
              Run
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="runner-mode" checked={mode === 'load'} disabled={busy} onChange={() => setMode('load')} />
              Load test
            </label>
          </div>
          <p className="faint txt-sm no-margin-top">
            Sends these requests in order, as Send does, with the <strong>{activeEnvironment.name}</strong> environment, and checks their assertions.
            {mode === 'run' && ' Cookies and response tags carry from one request to the next.'}
          </p>
          {requests && !requests.length && <p>There are no HTTP requests in {name}.</p>}
          <ul aria-label="Requests to run" className="list-none m-0 p-0">
            {(requests || []).map(({ request, folders: requestFolders }) => (
              <li key={request._id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!skipped.has(request._id)}
                    disabled={busy}
                    onChange={event => {
                      const next = new Set(skipped);
                      event.currentTarget.checked ? next.delete(request._id) : next.add(request._id);
                      setSkipped(next);
                    }}
                  />
                  <span className="faint monospace txt-sm">{request.method}</span>
                  {resultName({ folders: requestFolders, name: request.name })}
                </label>
              </li>
            ))}
          </ul>
          {mode === 'load' && <LoadTestPanel requests={chosen} name={name} onRunningChange={setLoadRunning} />}
          {mode === 'run' && (<>
          <div className="form-row margin-top">
            <div className="form-control form-control--outlined">
              <label>
                Iterations
                <input type="number" min={1} value={iterations} disabled={running} onChange={event => setIterations(Math.max(1, Number(event.currentTarget.value) || 1))} />
              </label>
            </div>
            <div className="form-control form-control--outlined">
              <label>
                Delay between requests (ms)
                <input type="number" min={0} value={delay} disabled={running} onChange={event => setDelay(Math.max(0, Number(event.currentTarget.value) || 0))} />
              </label>
            </div>
            <div className="form-control">
              <label>
                Data file, a row of variables per iteration
                <span className="flex items-center gap-2">
                  <button className="btn btn--clicky btn--compact" disabled={running} onClick={chooseData}>
                    {data ? `${path.basename(data.file)} (${data.rows.length} rows)` : 'Choose CSV or JSON'}
                  </button>
                  {data && (
                    <button className="btn btn--super-compact" aria-label="Clear data file" disabled={running} onClick={() => setData(undefined)}>
                      <i className="fa fa-times" />
                    </button>
                  )}
                </span>
              </label>
            </div>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={bail} disabled={running} onChange={event => setBail(event.currentTarget.checked)} />
            Stop at the first request that fails
          </label>
          {error && <p className="notice error">{error}</p>}
          {(running || results.length > 0) && (
            <section className="margin-top">
              <p data-testid="run-summary" className={summary ? (summary.requests.failed ? 'danger' : 'success') : 'faint'}>
                {summary
                  ? `${passed} of ${summary.requests.total} requests passed · ${summary.assertions.total - summary.assertions.failed} of ${summary.assertions.total} assertions passed · ${elapsed(summary.elapsedTime)}${summary.bailed ? ' · stopped at the first failure' : ''}${summary.stopped ? ' · stopped' : ''}`
                  : `Running: ${results.length} sent`}
              </p>
              <ul aria-label="Run results" className="list-none m-0 p-0">
                {results.map(result => (
                  <li key={`${result.iteration}-${result.requestId}`} aria-label={resultName(result)} className="pad-bottom-sm">
                    <details>
                      <summary className="flex items-center gap-2 pointer">
                        <i className={result.passed ? 'fa fa-check-circle-o success' : 'fa fa-times-circle danger'} aria-label={result.passed ? 'Passed' : 'Failed'} />
                        {iterations > 1 && <span className="faint">#{result.iteration}</span>}
                        <span className="faint monospace txt-sm">{result.method}</span>
                        <span className="flex-1">{resultName(result)}</span>
                        <span className="faint">{result.error ? 'Error' : `${result.statusCode ?? ''} ${result.statusMessage ?? ''}`} {elapsed(result.elapsedTime)}</span>
                      </summary>
                      <div className="pad-left">
                        {result.error && <p className="danger selectable">{result.error}</p>}
                        <AssertionResultsViewer results={result.assertions} />
                        <button className="btn btn--super-compact faint" onClick={() => openRequest(result.requestId)}>Open the request</button>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          )}
          </>)}
        </ModalBody>
        <ModalFooter>
          <div className="margin-left flex gap-2">
            {/* the run's report: a load test has its own */}
            {mode === 'run' && summary && (
              <>
                <button className="btn btn--compact" onClick={() => save('junit')}>Save JUnit</button>
                <button className="btn btn--compact" onClick={() => save('json')}>Save JSON</button>
              </>
            )}
          </div>
          {mode === 'run' && (running
            ? <button className="btn" onClick={() => controller.current?.abort()}>Stop</button>
            : <button className="btn" disabled={!chosen.length} onClick={run}>Run {chosen.length} {chosen.length === 1 ? 'request' : 'requests'}</button>)}
        </ModalFooter>
      </Modal>
    </OverlayContainer>
  );
};
