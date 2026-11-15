import React, { type FunctionComponent } from 'react';
import styled from 'styled-components';

import type { Request } from '../../../models/request';
import { requestDisplayName } from '../../utils/request-name';

interface UnitTestRequestSelectorProps {
  onSetActiveRequest: React.ChangeEventHandler<HTMLSelectElement>;
  selectedRequestId?: string | null;
  selectableRequests: Request[];
}

const StyledUnitTestRequestSelector = styled.div`
  padding: 0 var(--padding-sm);
  border: 1px solid var(--hl-md);
  border-radius: var(--radius-sm);
  margin: var(--padding-sm) var(--padding-sm) var(--padding-sm) auto;
  max-width: 18rem;
  flex: 0 0 auto;
  /* the select draws no outline of its own, so its box shows the focus */
  &:focus-within {
    border-color: var(--color-surprise);
  }
  select {
    max-width: 18rem;
    height: var(--line-height-xs);
    border: none !important;
    background: none !important;
    color: var(--font-color);

    &:focus {
      outline: 0;
    }
  }
  * {
    margin: 0px;
  }
`;

export const UnitTestRequestSelector: FunctionComponent<UnitTestRequestSelectorProps> = ({
  onSetActiveRequest,
  selectedRequestId,
  selectableRequests,
}) => {
  return (
    <StyledUnitTestRequestSelector>
      <select
        name="request"
        id="request"
        aria-label="Request"
        onChange={onSetActiveRequest}
        defaultValue={selectedRequestId || '__NULL__'}
      >
        <option value="__NULL__">
          {selectableRequests.length ? '-- Select Request --' : '-- No Requests --'}
        </option>
        {selectableRequests.map(request => (
          <option key={request._id} value={request._id}>
            {requestDisplayName(request)}
          </option>
        ))}
      </select>
    </StyledUnitTestRequestSelector>
  );
};
