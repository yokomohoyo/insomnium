import React, { FC } from 'react';

import { PHASE_LABELS, type PhaseDurations } from '../../common/timings';
import type { RequestRunStats } from '../../network/run-stats';

const PHASES = Object.keys(PHASE_LABELS) as (keyof PhaseDurations)[];

const PHASE_COLORS: Record<keyof PhaseDurations, string> = {
  dns: 'var(--color-info)',
  connect: 'var(--color-success)',
  tls: 'var(--color-warning)',
  wait: 'var(--color-surprise)',
  download: 'var(--color-notice)',
};

export const ms = (value?: number) => value === undefined ? '' : value < 1000 ? `${Math.round(value * 10) / 10} ms` : `${(value / 1000).toFixed(2)} s`;
export const size = (bytes?: number) => bytes === undefined ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// what a request's time is made of: each phase's share of it
const PhaseBar: FC<{ phases?: PhaseDurations }> = ({ phases }) => {
  const total = phases ? PHASES.reduce((sum, phase) => sum + phases[phase], 0) : 0;
  if (!phases || !total) {
    return null;
  }
  const label = PHASES.filter(phase => phase !== 'tls' || phases.tls > 0).map(phase => `${PHASE_LABELS[phase]} ${ms(phases[phase])}`).join(', ');
  return (
    <div role="img" aria-label={label} title={label} className="flex h-2 w-full rounded-sm overflow-hidden bg-[--hl-md]">
      {PHASES.filter(phase => phases[phase] > 0).map(phase => (
        <span key={phase} className="h-full" style={{ width: `${(phases[phase] / total) * 100}%`, background: PHASE_COLORS[phase] }} />
      ))}
    </div>
  );
};

// The runner's numbers for each request over the run: how fast, how steady,
// what a cold start costs, how big, and where the time goes
export const RunStatsTable: FC<{ stats: RequestRunStats[] }> = ({ stats }) => {
  const cold = stats.some(row => row.first !== undefined);
  return (
    <div className="margin-top-sm">
      <div className="overflow-x-auto">
        <table className="table--fancy table--striped" aria-label="Each request over the run">
          <thead>
            <tr>
              <th>Request</th>
              <th className="text-right">Sent</th>
              <th className="text-right">Failed</th>
              <th className="text-right">p50</th>
              <th className="text-right">p95</th>
              <th className="text-right">Max</th>
              <th className="text-right">Std dev</th>
              {cold && <th className="text-right" title="The first iteration's time, and the median of the others">First / later</th>}
              <th className="text-right">Size</th>
              <th className="min-w-[8rem]">Where the time goes</th>
            </tr>
          </thead>
          <tbody>
            {stats.map(row => (
              <tr key={row.requestId} aria-label={row.name}>
                <td><span className="faint monospace txt-sm">{row.method}</span> {row.name}</td>
                <td className="text-right">{row.count}</td>
                <td className={`text-right ${row.failed ? 'danger' : ''}`}>{row.failed}</td>
                <td className="text-right">{ms(row.p50)}</td>
                <td className="text-right">{ms(row.p95)}</td>
                <td className="text-right">{ms(row.max)}</td>
                <td className="text-right">{ms(row.sd)}</td>
                {cold && <td className="text-right">{row.first === undefined ? '' : `${ms(row.first)} / ${ms(row.warmP50)}`}</td>}
                <td className="text-right">{size(row.bytes)}</td>
                <td className="align-middle"><PhaseBar phases={row.phases} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap gap-3 txt-sm faint" aria-hidden="true">
        {PHASES.map(phase => (
          <span key={phase} className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: PHASE_COLORS[phase] }} />
            {PHASE_LABELS[phase]}
          </span>
        ))}
      </p>
    </div>
  );
};
