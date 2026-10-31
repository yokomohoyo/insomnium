import type { TimelinePoint } from './load-stats';

// Where a load test's timeline draws, for the live chart and the HTML report
// alike: a bar a second for the requests sent (its failed part on top), and a
// line each for the p50 and p95 latency, on their own scale.

export interface TimelineGeometry {
  width: number;
  height: number;
  // the plot's top and bottom, inside the axes' labels
  top: number;
  bottom: number;
  bars: { x: number; width: number; y: number; failedY: number; point: TimelinePoint }[];
  // SVG polyline points
  p50: string;
  p95: string;
  maxRequests: number;
  maxLatency: number;
}

export const CHART_WIDTH = 800;
export const CHART_HEIGHT = 180;
const TOP = 12;
const BOTTOM = CHART_HEIGHT - 20;

const round = (value: number) => Math.round(value * 10) / 10;

export function timelineGeometry(points: TimelinePoint[], width = CHART_WIDTH, height = CHART_HEIGHT): TimelineGeometry {
  const bottom = height - (CHART_HEIGHT - BOTTOM);
  const plot = bottom - TOP;
  const maxRequests = Math.max(1, ...points.map(point => point.requests));
  const maxLatency = Math.max(1, ...points.map(point => point.p95));
  const slot = width / Math.max(1, points.length);
  const gap = Math.min(2, slot / 4);
  const yRequests = (count: number) => round(bottom - (count / maxRequests) * plot);
  const yLatency = (ms: number) => round(bottom - (ms / maxLatency) * plot);
  const centre = (index: number) => round(index * slot + slot / 2);
  // a second with nothing sent has no latency to draw
  const line = (key: 'p50' | 'p95') => points
    .map((point, index) => point.requests ? `${centre(index)},${yLatency(point[key])}` : '')
    .filter(Boolean)
    .join(' ');
  return {
    width,
    height,
    top: TOP,
    bottom,
    bars: points.map((point, index) => ({
      x: round(index * slot + gap / 2),
      width: round(Math.max(0.5, slot - gap)),
      y: yRequests(point.requests),
      failedY: yRequests(point.failed),
      point,
    })),
    p50: line('p50'),
    p95: line('p95'),
    maxRequests,
    maxLatency,
  };
}

// what a second's bar says when hovered or read out
export const describeSecond = (point: TimelinePoint) =>
  `${point.second}–${point.second + 1} s: ${point.requests} sent${point.failed ? `, ${point.failed} failed` : ''}, p50 ${point.p50} ms, p95 ${point.p95} ms, ${point.users} ${point.users === 1 ? 'user' : 'users'}`;

// what the whole chart says, for a screen reader
export function describeTimeline(points: TimelinePoint[]) {
  const busy = points.filter(point => point.requests);
  if (!busy.length) {
    return 'Nothing sent yet';
  }
  const peak = Math.max(...busy.map(point => point.requests));
  const worst = busy.reduce((max, point) => point.p95 > max.p95 ? point : max, busy[0]);
  const failed = points.reduce((sum, point) => sum + point.failed, 0);
  return `${points.length} seconds: up to ${peak} requests a second; the slowest second's p95 was ${worst.p95} ms, at ${worst.second} s${failed ? `; ${failed} failed` : ''}`;
}
