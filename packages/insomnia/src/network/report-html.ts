import { PHASE_LABELS, type PhaseDurations } from '../common/timings';
import type { TimelinePoint } from './load-stats';
import { describeSecond, describeTimeline, timelineGeometry } from './timeline-chart';

// What the run and load test HTML reports share: one self-contained page each,
// with no scripts and nothing fetched, in light and dark.

export const xml = (text: unknown) => String(text ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // characters XML 1.0 can't hold at all
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export const ms = (value?: number) => value === undefined ? '' : value < 1000 ? `${value.toFixed(1)} ms` : `${(value / 1000).toFixed(2)} s`;
export const size = (bytes?: number) => bytes === undefined ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const PHASES = Object.keys(PHASE_LABELS) as (keyof PhaseDurations)[];

const PHASE_COLORS: Record<keyof PhaseDurations, string> = {
  dns: '#7aa2f7',
  connect: '#9ece6a',
  tls: '#e0af68',
  wait: '#bb9af7',
  download: '#2ac3de',
};

// where a request's time goes, as a bar of its phases
export const phaseBar = (phases?: PhaseDurations) => {
  if (!phases) {
    return '';
  }
  const total = PHASES.reduce((sum, phase) => sum + phases[phase], 0);
  if (!total) {
    return '';
  }
  const parts = PHASES
    .filter(phase => phases[phase] > 0)
    .map(phase => `<span style="width:${(phases[phase] / total * 100).toFixed(2)}%;background:${PHASE_COLORS[phase]}" title="${xml(PHASE_LABELS[phase])}: ${ms(phases[phase])}"></span>`);
  const title = PHASES
    .filter(phase => phase !== 'tls' || phases.tls > 0)
    .map(phase => `${PHASE_LABELS[phase]} ${ms(phases[phase])}`)
    .join(', ');
  return `<div class="bar" role="img" aria-label="${xml(title)}">${parts.join('')}</div>`;
};

export const phaseLegend = () =>
  `<div class="legend">${PHASES.map(phase => `<span><i style="background:${PHASE_COLORS[phase]}"></i>${xml(PHASE_LABELS[phase])}</span>`).join('')}</div>`;

export const card = (value: string, label: string, tone?: 'good' | 'bad') =>
  `<div class="card"><b${tone ? ` class="${tone}"` : ''}>${value}</b>${label}</div>`;

// a load test's seconds: requests sent as bars (failures on top), and the p50
// and p95 latency as lines on their own scale
const height = (from: number, to: number) => Math.max(0, Math.round((to - from) * 10) / 10);

export const timelineSvg = (points: TimelinePoint[]) => {
  const chart = timelineGeometry(points);
  const bars = chart.bars.map(bar => [
    `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${height(bar.y, chart.bottom)}" class="sent"><title>${xml(describeSecond(bar.point))}</title></rect>`,
    bar.point.failed ? `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${height(bar.failedY, chart.bottom)}" class="failed"/>` : '',
  ].join('')).join('');
  return `<figure class="chart">
<svg viewBox="0 0 ${chart.width} ${chart.height}" role="img" aria-label="${xml(describeTimeline(points))}" preserveAspectRatio="none">
<line x1="0" y1="${chart.bottom}" x2="${chart.width}" y2="${chart.bottom}" class="axis"/>
${bars}
<polyline points="${chart.p95}" class="p95"/>
<polyline points="${chart.p50}" class="p50"/>
</svg>
<figcaption class="legend"><span><i class="sent"></i>Requests a second (up to ${chart.maxRequests})</span><span><i class="failed"></i>Failed</span><span><i class="p50"></i>p50</span><span><i class="p95"></i>p95 (up to ${ms(chart.maxLatency)})</span><span>Seconds 0–${points.length}</span></figcaption>
</figure>`;
};

export const reportPage = ({ title, heading, subtitle, body }: { title: string; heading: string; subtitle: string; body: string }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${xml(title)}</title>
<style>
:root { color-scheme: light dark; --bg: #fff; --fg: #1f2328; --faint: #656d76; --line: #d0d7de; --good: #1a7f37; --bad: #cf222e; --sent: #8c959f; --p50: #0969da; --p95: #bf8700; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --faint: #8d96a0; --line: #30363d; --good: #3fb950; --bad: #f85149; --sent: #6e7681; --p50: #58a6ff; --p95: #d29922; } }
body { margin: 0 auto; max-width: 1100px; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; }
.faint { color: var(--faint); } .good { color: var(--good); } .bad { color: var(--bad); }
.cards { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
.card { border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; min-width: 120px; }
.card b { display: block; font-size: 18px; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: middle; white-space: nowrap; }
th { font-weight: 600; color: var(--faint); font-size: 12px; }
.n { text-align: right; font-variant-numeric: tabular-nums; }
.method { font: 11px ui-monospace, monospace; color: var(--faint); }
.phases { min-width: 160px; width: 25%; }
.bar { display: flex; height: 10px; border-radius: 3px; overflow: hidden; background: var(--line); }
.bar span { display: block; height: 100%; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--faint); margin-top: 8px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.chart { margin: 0; }
.chart svg { display: block; width: 100%; height: 180px; }
.chart .axis { stroke: var(--line); }
.chart rect.sent, .legend i.sent { fill: var(--sent); background: var(--sent); }
.chart rect.failed, .legend i.failed { fill: var(--bad); background: var(--bad); }
.chart polyline { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; }
.chart .p50 { stroke: var(--p50); } .legend i.p50 { background: var(--p50); }
.chart .p95 { stroke: var(--p95); } .legend i.p95 { background: var(--p95); }
ul.checks { list-style: none; padding: 0; } ul.checks li::before { margin-right: 6px; }
ul.checks li.good::before { content: "✓"; } ul.checks li.bad::before { content: "✗"; }
</style>
</head>
<body>
<h1>${xml(heading)}</h1>
<div class="faint">${xml(subtitle)}</div>
${body}
</body>
</html>
`;

export const generatedAt = (date: Date) => `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
