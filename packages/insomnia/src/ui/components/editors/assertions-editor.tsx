import React, { FC, useRef, useState } from 'react';
import { useParams, useRouteLoaderData } from 'react-router-dom';

import { generateId } from '../../../common/misc';
import type { Request } from '../../../models/request';
import {
  ASSERTION_OPERATORS,
  ASSERTION_SOURCES,
  AssertionOperator,
  AssertionSource,
  operatorHasValue,
  RequestAssertion,
  sourceHasProperty,
} from '../../../network/assertions';
import { useRequestSetter } from '../../hooks/use-request';
import { RequestLoaderData } from '../../routes/request';

const PROPERTY_PLACEHOLDERS: Partial<Record<AssertionSource, string>> = {
  header: 'Content-Type',
  jsonpath: '$.data.id',
};

// The request's assertions, checked after each send. Edits build on a local
// copy, not the loader data: that lags behind the saves, so a quick second
// edit would otherwise write the list back without the first. The pane
// remounts this when the request changes elsewhere.
export const AssertionsEditor: FC = () => {
  const { requestId } = useParams() as { requestId: string };
  const { activeRequest } = useRouteLoaderData('request/:requestId') as RequestLoaderData;
  const patchRequest = useRequestSetter();
  const [assertions, setAssertions] = useState<RequestAssertion[]>(() => (activeRequest as Request).assertions || []);
  const latest = useRef(assertions);

  const save = (next: RequestAssertion[]) => {
    latest.current = next;
    setAssertions(next);
    patchRequest(requestId, { assertions: next });
  };
  const change = (id: string, patch: Partial<RequestAssertion>) =>
    save(latest.current.map(assertion => assertion.id === id ? { ...assertion, ...patch } : assertion));
  const add = () => save([...latest.current, { id: generateId('asrt'), source: 'status', operator: 'equals', value: '200' }]);

  return (
    <div className="pad">
      <ul aria-label="Assertions" className="list-none m-0 p-0">
        {assertions.map((assertion, index) => (
          <li key={assertion.id} aria-label={`Assertion ${index + 1}`} className="flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              aria-label="Enabled"
              checked={!assertion.disabled}
              onChange={event => change(assertion.id, { disabled: !event.currentTarget.checked })}
            />
            <select
              aria-label="Source"
              value={assertion.source}
              onChange={event => change(assertion.id, { source: event.currentTarget.value as AssertionSource })}
            >
              {Object.entries(ASSERTION_SOURCES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {sourceHasProperty(assertion.source) && (
              <div className="form-control form-control--outlined flex-1 m-0">
                <input
                  type="text"
                  aria-label="Property"
                  placeholder={PROPERTY_PLACEHOLDERS[assertion.source]}
                  value={assertion.property || ''}
                  onChange={event => change(assertion.id, { property: event.currentTarget.value })}
                />
              </div>
            )}
            <select
              aria-label="Operator"
              value={assertion.operator}
              onChange={event => change(assertion.id, { operator: event.currentTarget.value as AssertionOperator })}
            >
              {Object.entries(ASSERTION_OPERATORS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {operatorHasValue(assertion.operator) && (
              <div className="form-control form-control--outlined flex-1 m-0">
                <input
                  type="text"
                  aria-label="Expected"
                  placeholder={assertion.operator === 'matchesSchema' ? 'a JSON Schema, such as {"type": "object", "required": ["id"]}' : 'value or {{ variable }}'}
                  value={assertion.value || ''}
                  onChange={event => change(assertion.id, { value: event.currentTarget.value })}
                />
              </div>
            )}
            <button
              className="btn btn--super-compact"
              aria-label="Delete assertion"
              title="Delete assertion"
              onClick={() => save(latest.current.filter(({ id }) => id !== assertion.id))}
            >
              <i className="fa fa-trash-o" />
            </button>
          </li>
        ))}
      </ul>
      <button className="btn btn--clicky btn--compact" onClick={add}>
        <i className="fa fa-plus space-right" />Add assertion
      </button>
      <p className="faint txt-sm">
        Checked after each send, with the results in the response's Tests tab. Values can use variables.
      </p>
    </div>
  );
};
