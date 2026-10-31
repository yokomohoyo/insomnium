import fs from 'fs';
import React, { FC, useEffect, useRef, useState } from 'react';

import { loadCsvReport, loadHtmlReport, loadJsonReport } from '../../network/load-report';
import { checkThresholds, type LoadSummary, type LoadThresholds } from '../../network/load-stats';
import { MAX_VIRTUAL_USERS, runLoadTest } from '../../network/load-test';
import type { RunnableRequest } from '../../network/runner';
import { LoadTimelineChart } from './load-timeline-chart';
import { PhaseBar, size } from './run-stats-table';

const ms = (value: number) => `${value} ms`;
const whole = (value: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value)) || min));
// an optional limit: empty for none
const limit = (value: string) => value.trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0 ? undefined : Number(value);

// what a finished load test saves as
const REPORTS = {
  html: { button: 'Save HTML', label: 'HTML report', extension: 'html', write: loadHtmlReport },
  csv: { button: 'Save CSV', label: 'CSV of each second', extension: 'csv', write: (summary: LoadSummary) => loadCsvReport(summary) },
  json: { button: 'Save JSON', label: 'JSON report', extension: 'json', write: loadJsonReport },
};

// The runner's load test: virtual users sending the chosen requests over and
// over for a while, with latency percentiles, throughput and errors, second by
// second, checked against the limits it's given
export const LoadTestPanel: FC<{
  requests: RunnableRequest[];
  name: string;
  onRunningChange: (running: boolean) => void;
}> = ({ requests, name, onRunningChange }) => {
  const [virtualUsers, setVirtualUsers] = useState(5);
  const [duration, setDuration] = useState(30);
  const [rampUp, setRampUp] = useState(0);
  const [thinkTime, setThinkTime] = useState(0);
  const [maxP95, setMaxP95] = useState('');
  const [maxErrors, setMaxErrors] = useState('');
  const [summary, setSummary] = useState<LoadSummary>();
  // the thresholds the finished test was held to
  const [heldTo, setHeldTo] = useState<LoadThresholds>({});
  const [finished, setFinished] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController>();

  // closing the runner stops the test
  useEffect(() => () => controller.current?.abort(), []);

  const thresholds = (): LoadThresholds => {
    const p95 = limit(maxP95);
    const errors = limit(maxErrors);
    return {
      ...(p95 !== undefined ? { p95 } : {}),
      ...(errors !== undefined ? { errorRate: Math.min(100, errors) / 100 } : {}),
    };
  };

  const start = async () => {
    setError('');
    setSummary(undefined);
    setFinished(false);
    setHeldTo(thresholds());
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

  const save = async (kind: keyof typeof REPORTS) => {
    if (!summary) {
      return;
    }
    const report = REPORTS[kind];
    const { canceled, filePath } = await window.dialog.showSaveDialog({
      title: `Save the load test's ${report.label}`,
      buttonLabel: 'Save',
      defaultPath: `${name.replace(/[\\/:*?"<>|]/g, '-')}-load.${report.extension}`,
    });
    if (!canceled && filePath) {
      await fs.promises.writeFile(filePath, report.write(summary, name, heldTo));
    }
  };

  const checks = summary && finished ? checkThresholds(summary, heldTo) : [];
  const broken = checks.some(check => !check.passed);

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
      <div className="form-row">
        <div className="form-control form-control--outlined">
          <label>
            Fail when p95 is over (ms)
            <input type="number" min={0} placeholder="No limit" value={maxP95} disabled={running} onChange={event => setMaxP95(event.currentTarget.value)} />
          </label>
        </div>
        <div className="form-control form-control--outlined">
          <label>
            Fail when more than this fail (%)
            <input type="number" min={0} max={100} step="any" placeholder="No limit" value={maxErrors} disabled={running} onChange={event => setMaxErrors(event.currentTarget.value)} />
          </label>
        </div>
      </div>
      <div className="flex gap-2">
        {running
          ? <button className="btn btn--clicky" onClick={() => controller.current?.abort()}>Stop</button>
          : <button className="btn btn--clicky" disabled={!requests.length} onClick={start}>Start the Load Test</button>}
        {summary && !running && (Object.keys(REPORTS) as (keyof typeof REPORTS)[]).map(kind => (
          <button key={kind} className="btn btn--compact" onClick={() => save(kind)}>{REPORTS[kind].button}</button>
        ))}
      </div>
      {error && <p className="notice error">{error}</p>}
      {summary && (
        <div className="margin-top">
          <p data-testid="load-summary" className={finished ? (summary.failed || broken ? 'danger' : 'success') : 'faint'}>
            {finished ? '' : 'Running: '}
            {summary.requests} requests · {summary.throughput}/s · {summary.failed} failed ({(summary.errorRate * 100).toFixed(1)}%) · p95 {ms(summary.latency.p95)} · {(summary.durationMs / 1000).toFixed(1)} s
            {summary.stopped ? ' · stopped' : ''}
          </p>
          {checks.length > 0 && (
            <ul aria-label="Thresholds" className="list-none m-0 p-0 txt-sm">
              {checks.map(check => (
                <li key={check.message} className={check.passed ? 'success' : 'danger'}>
                  <i className={check.passed ? 'fa fa-check-circle-o' : 'fa fa-times-circle'} aria-label={check.passed ? 'Passed' : 'Failed'} /> {check.message}
                </li>
              ))}
            </ul>
          )}
          <LoadTimelineChart points={summary.timeline} />
          <div className="overflow-x-auto">
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
                  <th className="text-right">Size</th>
                  <th className="min-w-[8rem]">Where the time goes</th>
                </tr>
              </thead>
              <tbody>
                {[...summary.byRequest, { requestId: 'all', name: 'All', ...summary.latency, count: summary.requests, failed: summary.failed, phases: undefined, bytes: undefined }].map(row => (
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
                    <td className="text-right">{size(row.bytes)}</td>
                    <td className="align-middle"><PhaseBar phases={row.phases} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
