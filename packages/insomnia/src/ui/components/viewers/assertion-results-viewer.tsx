import React, { FC } from 'react';

import type { AssertionResult } from '../../../network/assertions';
import type { ScriptLog } from '../../../scripting/sandbox';

const LEVEL_CLASSES: Record<string, string> = { error: 'danger', warn: 'warning', debug: 'faint' };

// The response's assertions and script tests, then what its scripts logged
export const AssertionResultsViewer: FC<{ results?: AssertionResult[]; logs?: ScriptLog[] }> = ({ results, logs }) => {
  const passed = (results || []).filter(result => result.passed).length;
  return (
    <>
      {results?.length ? (
        <>
          <p className={passed === results.length ? 'success' : 'danger'} data-testid="assertion-summary">
            {passed} of {results.length} passed
          </p>
          <ul aria-label="Assertion results" className="list-none m-0 p-0">
            {results.map(result => (
              <li key={result.id} className="flex items-start gap-2 py-1">
                <i
                  className={`fa ${result.passed ? 'fa-check-circle-o success' : 'fa-times-circle danger'}`}
                  aria-label={result.passed ? 'Passed' : 'Failed'}
                />
                <span className="selectable">{result.message}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="faint">No assertions or script tests were checked. Add them in the request&apos;s Assertions or Scripts tab.</p>
      )}
      {logs?.length ? (
        <section aria-label="Script console" className="margin-top">
          <strong className="txt-sm">Console</strong>
          <pre className="selectable txt-sm pad-top-sm" data-testid="script-console">
            {logs.map((log, index) => (
              // eslint-disable-next-line react/no-array-index-key -- the logs are in order and never change
              <div key={index} className={LEVEL_CLASSES[log.level] || ''}>{log.message}</div>
            ))}
          </pre>
        </section>
      ) : null}
    </>
  );
};
