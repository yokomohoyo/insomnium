// A security run against an earlier one: which findings were there before
// (known) and which weren't (new), so a pipeline can fail on the new ones
// alone and still say what's outstanding. The baseline is an earlier run's
// JSON report (security-report.ts), kept with the collection.
import type { AuditFinding, AuditSeverity } from '../common/response-audit';
import type { SecurityRunItem, SecurityRunSummary } from './security-run';

// What says two runs' requests are the same one: its method and where it is
// in the collection. Not its id: a collection read from a file gets new ids
// every time it's read, so in a pipeline no id outlives the run. A request
// that is renamed or moved has new findings, then.
export const requestKey = ({ method, folders, name }: Pick<SecurityRunItem, 'method' | 'folders' | 'name'>) => `${method} ${[...folders, name].join(' / ')}`;

export interface BaselineEntry {
  // the request (requestKey)
  key: string;
  // the rule
  id: string;
  evidence?: string;
  title: string;
  // "Orders / List": the request as the earlier report named it
  request: string;
}

export interface BaselineComparison {
  // findings the baseline had too
  known: number;
  // the ones it didn't, by severity: what a run fails on
  fresh: Record<AuditSeverity, number>;
  // the baseline's findings that this run looked for and didn't find
  fixed: BaselineEntry[];
}

// The findings of an earlier JSON report. Throws when the text isn't one:
// a baseline that can't be read mustn't pass for one with nothing in it
export const readBaseline = (text: string): BaselineEntry[] => {
  let report: unknown;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error('it is not JSON');
  }
  const items = (report as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) {
    throw new Error('it is not a security report: write one with --json, and use that');
  }
  return items.flatMap(item => {
    const { method, findings, folders, name } = (item || {}) as Partial<SecurityRunItem>;
    if (typeof name !== 'string' || typeof method !== 'string' || !Array.isArray(findings)) {
      throw new Error('it is not a security report: a request in it has no name, no method or no findings');
    }
    const path = Array.isArray(folders) ? folders : [];
    const request = [...path, name].join(' / ');
    const key = requestKey({ method, folders: path, name });
    return findings
      .filter(finding => finding && typeof finding.id === 'string')
      .map(({ id, evidence, title }) => ({ key, id, ...(evidence ? { evidence } : {}), title: title || id, request }));
  });
};

// Compares a run with a baseline as the run goes: mark() each request when
// it's done (its findings that the baseline has get `known`), then result().
//
// A finding is the baseline's when the rule and the request are the same, and
// the evidence too where a baseline finding has the same; failing that, one of
// the same rule on the same request whose evidence changed (a burst of another
// size, a header's new value). Each baseline finding answers for one finding,
// so a second cookie with the fault the first one had is new.
export const baselineMatcher = (baseline: BaselineEntry[]) => {
  const left = baseline.map(entry => ({ entry, used: false }));
  const fresh: Record<AuditSeverity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  // the requests this run looked at: a baseline finding on any other request
  // (another folder's, or one that couldn't be tested) wasn't looked for
  const looked = new Set<string>();
  let known = 0;

  const take = (key: string, finding: AuditFinding) => {
    const same = left.filter(({ entry, used }) => !used && entry.key === key && entry.id === finding.id);
    const match = same.find(({ entry }) => (entry.evidence || '') === (finding.evidence || '')) || same[0];
    if (match) {
      match.used = true;
    }
    return Boolean(match);
  };

  return {
    mark(item: SecurityRunItem) {
      const key = requestKey(item);
      if (item.outcome !== 'skipped') {
        looked.add(key);
      }
      // exact matches first, so a finding whose evidence changed can't take
      // the baseline's entry for one that hasn't
      const exact = item.findings.map(finding => {
        const match = left.find(({ entry, used }) => !used && entry.key === key && entry.id === finding.id && (entry.evidence || '') === (finding.evidence || ''));
        if (match) {
          match.used = true;
        }
        return Boolean(match);
      });
      item.findings = item.findings.map((finding, index) => {
        if (exact[index] || take(key, finding)) {
          known++;
          return { ...finding, known: true };
        }
        fresh[finding.severity]++;
        return finding;
      });
    },
    result: (): BaselineComparison => ({
      known,
      fresh,
      fixed: left.filter(({ entry, used }) => !used && looked.has(entry.key)).map(({ entry }) => entry),
    }),
  };
};

// the same, for a run that's finished
export const compareWithBaseline = (summary: SecurityRunSummary, baseline: BaselineEntry[]) => {
  const matcher = baselineMatcher(baseline);
  summary.items.forEach(item => matcher.mark(item));
  return matcher.result();
};
