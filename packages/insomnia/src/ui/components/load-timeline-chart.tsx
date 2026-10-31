import React, { FC } from 'react';

import type { TimelinePoint } from '../../network/load-stats';
import { describeSecond, describeTimeline, timelineGeometry } from '../../network/timeline-chart';

const ms = (value: number) => value < 1000 ? `${Math.round(value * 10) / 10} ms` : `${(value / 1000).toFixed(2)} s`;

// A load test second by second, as it runs: requests sent as bars (failures
// in red on top), and the p50 and p95 latency as lines on their own scale
export const LoadTimelineChart: FC<{ points: TimelinePoint[] }> = ({ points }) => {
  const chart = timelineGeometry(points);
  return (
    <figure className="m-0 margin-top-sm">
      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={describeTimeline(points)}
        className="block w-full h-[160px]"
      >
        <line x1={0} y1={chart.bottom} x2={chart.width} y2={chart.bottom} stroke="var(--hl-md)" />
        {chart.bars.map(bar => (
          <g key={bar.point.second}>
            <rect x={bar.x} y={bar.y} width={bar.width} height={Math.max(0, chart.bottom - bar.y)} fill="var(--hl-xl)">
              <title>{describeSecond(bar.point)}</title>
            </rect>
            {bar.point.failed > 0 && <rect x={bar.x} y={bar.y} width={bar.width} height={Math.max(0, chart.bottom - bar.failedY)} fill="var(--color-danger)" />}
          </g>
        ))}
        <polyline points={chart.p95} fill="none" stroke="var(--color-warning)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <polyline points={chart.p50} fill="none" stroke="var(--color-info)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="flex flex-wrap gap-3 txt-sm faint" aria-hidden="true">
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[--hl-xl]" />Requests a second (up to {chart.maxRequests})</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[--color-danger]" />Failed</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[--color-info]" />p50</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-[--color-warning]" />p95 (up to {ms(chart.maxLatency)})</span>
        <span>{points.length} s</span>
      </figcaption>
    </figure>
  );
};
