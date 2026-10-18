import React, { FC } from 'react';

import type { AssertionResult } from '../../../network/assertions';

export const AssertionResultsViewer: FC<{ results?: AssertionResult[] }> = ({ results }) => {
  if (!results?.length) {
    return <p className="faint">No assertions were checked. Add them in the request's Assertions tab.</p>;
  }
  const passed = results.filter(result => result.passed).length;
  return (
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
  );
};
