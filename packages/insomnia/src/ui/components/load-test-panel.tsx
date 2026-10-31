import fs from 'fs';
import React, { FC, useEffect, useRef, useState } from 'react';

import type { LoadSummary } from '../../network/load-stats';
import { MAX_VIRTUAL_USERS, runLoadTest } from '../../network/load-test';
import type { RunnableRequest } from '../../network/runner';

const ms = (value: number) => `${value} ms`;
const whole = (value: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value)) || min));

// The runner's load test: virtual users sending the chosen requests over and
// over for a while, with latency percentiles, throughput and errors
export const LoadTestPanel: FC<{
  requests: RunnableRequest[];
  name: string;
  onRunningChange: (running: boolean) => void;
}> = ({ requests, name, onRunningChange }) => {
  const [virtualUsers, setVirtualUsers] = useState(5);
  const [duration, setDuration] = useState(30);
  const [rampUp, setRampUp] = useState(0);
  const [thinkTime, setThinkTime] = useState(0);
  const [summary, setSummary] = useState<LoadSummary>();
  const [finished, setFinished] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController>();

  // closing the runner stops the test
  useEffect(() => () => controller.current?.abort(), []);

  const start = async () => {
    setError('');
    setSummary(undefined);
    setFinished(false);
    setRunning(true);
    onRunningChange(true);
    controller.current = new AbortController();
    try {
      setSummary(await runLoadTest(requests, {
        virtualUsers,
        durationMs: duration * 1000,
        rampUpMs: rampUp * 1000,
        thinkTimeMs: thinkTime,
        signal: controller.current.signal,
        onProgress: setSummary,
      }));
      setFinished(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
      onRunningChange(false);
    }
  };

  const save = async () => {
    if (!summary) {
      return;
    }
    const { canceled, filePath } = await window.dialog.showSaveDialog({
      title: 'Save the load test',
      buttonLabel: 'Save',
      defaultPath: `${name.replace(/[\\/:*?"<>|]/g, '-')}-load.json`,
    });
    if (!canceled && filePath) {
      await fs.promises.writeFile(filePath, JSON.stringify({ name, ...summary }, null, 2));
    }
  };

  return (
    <section aria-label="Load test">
      <p className="faint txt-sm margin-top">
        Each virtual user sends these requests in order, again and again, until the time is up. A request fails when it can&apos;t be sent, answers 400 or above (unless it has its own status assertion), or fails an assertion.
        Responses aren&apos;t kept. Load test only APIs you&apos;re allowed to.
      </p>
      <div className="form-row">
        <div className="form-control form-control--outlined">
          <label>
            Virtual users
            <input type="number" min={1} max={MAX_VIRTUAL_USERS} value={virtualUsers} disabled={running} onChange={event => setVirtualUsers(whole(event.currentTarget.value, 1, MAX_VIRTUAL_USERS))} />
          </label>
        </div>
        <div className="form-control form-control--outlined">
          <label>
            Duration (s)
            <input type="number" min={1} max={3600} value={duration} disabled={running} onChange={event => setDuration(whole(event.currentTarget.value, 1, 3600))} />
          </label>
        </div>
        <div className="form-control form-control--outlined">
          <label>
            Ramp-up (s)
            <input type="number" min={0} max={3600} value={rampUp} disabled={running} onChange={event => setRampUp(whole(event.currentTarget.value, 0, 3600))} />
          </label>
        </div>
        <div className="form-control form-control--outlined">
          <label>
            Think time (ms)
            <input type="number" min={0} max={60000} value={thinkTime} disabled={running} onChange={event => setThinkTime(whole(event.currentTarget.value, 0, 60000))} />
          </label>
        </div>
      </div>
      <div className="flex gap-2">
        {running
          ? <button className="btn btn--clicky" onClick={() => controller.current?.abort()}>Stop</button>
          : <button className="btn btn--clicky" disabled={!requests.length} onClick={start}>Start the Load Test</button>}
        {summary && !running && <button className="btn btn--compact" onClick={save}>Save JSON</button>}
      </div>
      {error && <p className="notice error">{error}</p>}
      {summary && (
        <div className="margin-top">
          <p data-testid="load-summary" className={finished ? (summary.failed ? 'danger' : 'success') : 'faint'}>
            {finished ? '' : 'Running: '}
            {summary.requests} requests · {summary.throughput}/s · {summary.failed} failed ({(summary.errorRate * 100).toFixed(1)}%) · p95 {ms(summary.latency.p95)} · {(summary.durationMs / 1000).toFixed(1)} s
            {summary.stopped ? ' · stopped' : ''}
          </p>
          <table className="table--fancy table--striped" aria-label="Load test results">
            <thead>
              <tr>
                <th>Request</th>
                <th className="text-right">Sent</th>
                <th className="text-right">Failed</th>
                <th className="text-right">Mean</th>
                <th className="text-right">p50</th>
                <th className="text-right">p90</th>
                <th className="text-right">p95</th>
                <th className="text-right">p99</th>
                <th className="text-right">Max</th>
              </tr>
            </thead>
            <tbody>
              {[...summary.byRequest, { requestId: 'all', name: 'All', ...summary.latency, count: summary.requests, failed: summary.failed }].map(row => (
                <tr key={row.requestId} aria-label={row.name}>
                  <td>{row.requestId === 'all' ? <strong>All</strong> : row.name}</td>
                  <td className="text-right">{row.count}</td>
                  <td className={`text-right ${row.failed ? 'danger' : ''}`}>{row.failed}</td>
                  <td className="text-right">{ms(row.mean)}</td>
                  <td className="text-right">{ms(row.p50)}</td>
                  <td className="text-right">{ms(row.p90)}</td>
                  <td className="text-right">{ms(row.p95)}</td>
                  <td className="text-right">{ms(row.p99)}</td>
                  <td className="text-right">{ms(row.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="txt-sm faint">
            Status codes: {Object.entries(summary.statusCodes).map(([code, count]) => `${code} × ${count}`).join(', ') || 'none yet'}
          </p>
          {summary.failures.length > 0 && (
            <ul className="txt-sm" aria-label="Load test failures">
              {summary.failures.map(failure => <li key={failure.reason} className="danger selectable">{failure.count} × {failure.reason}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
