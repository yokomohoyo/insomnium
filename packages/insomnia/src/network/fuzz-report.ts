// A fuzz run to keep: its attempts as CSV, or the run as it is as JSON
import type { FuzzRunSummary } from './fuzz-run';

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

export const fuzzCsv = (summary: FuzzRunSummary) => [
  ['attempt', 'position', 'payload', 'status', 'bytes', 'ms', 'worth a look', 'what it showed', 'error'],
  ...summary.attempts.map(attempt => [attempt.index, attempt.position, attempt.payload, attempt.statusCode || '', attempt.bytes, Math.round(attempt.elapsed), attempt.notable ? 'yes' : '', attempt.flags.map(({ label }) => label).join('; '), attempt.error || '']),
].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

export const fuzzJson = (summary: FuzzRunSummary, name: string, generated = new Date()) => JSON.stringify({ name, generated: generated.toISOString(), ...summary }, null, 2);
