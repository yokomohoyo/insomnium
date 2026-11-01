import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react';

import { database } from '../../../common/database';

let mockRequestId = 'req_1';
jest.mock('react-router-dom', () => ({
  ...(jest.requireActual('react-router-dom') as object),
  useParams: () => ({ requestId: mockRequestId }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useActiveRequestSyncVCSVersion } = require('../use-vcs-version');

describe('useActiveRequestSyncVCSVersion()', () => {
  it('listens for one request at a time, and not once it has gone', () => {
    const added = jest.spyOn(database, 'onChange');
    const removed = jest.spyOn(database, 'offChange');
    const { rerender, unmount } = renderHook(() => useActiveRequestSyncVCSVersion());
    for (const id of ['req_2', 'req_3', 'req_4']) {
      mockRequestId = id;
      rerender();
    }
    // one listener for each request opened, each removed when the next came
    expect(added).toHaveBeenCalledTimes(4);
    expect(removed).toHaveBeenCalledTimes(3);

    unmount();
    expect(removed.mock.calls.map(([listener]) => listener)).toEqual(added.mock.calls.map(([listener]) => listener));
  });
});
