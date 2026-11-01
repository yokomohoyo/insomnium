/**
 * @jest-environment node
 */
import { describe, expect, it, jest } from '@jest/globals';

import { rememberLocation } from '../remember-location';

describe('rememberLocation()', () => {
  it('keeps the location when it changes, not on every change of the router', () => {
    let listener: (state: { location: { pathname: string } }) => void = () => {};
    const router = { subscribe: (next: typeof listener) => {
      listener = next;
      return () => {};
    } };
    const storage = { setItem: jest.fn() };
    rememberLocation(router, storage);

    const at = (pathname: string) => listener({ location: { pathname } });
    at('/organization/org_1/project/proj_1/workspace/wrk_1/debug/request/req_1');
    // fetchers and revalidations, at the same place
    at('/organization/org_1/project/proj_1/workspace/wrk_1/debug/request/req_1');
    at('/organization/org_1/project/proj_1/workspace/wrk_1/debug/request/req_1');
    at('/organization/org_1/project/proj_1/workspace/wrk_1/debug/request/req_2');

    expect(storage.setItem.mock.calls).toEqual([
      ['requester_locationHistoryEntry', '/organization/org_1/project/proj_1/workspace/wrk_1/debug/request/req_1'],
      ['locationHistoryEntry', '/organization/org_1/project/proj_1/workspace/wrk_1/debug/request/req_1'],
      ['locationHistoryEntry:org_1', '/organization/org_1/project/proj_1/workspace/wrk_1/debug/request/req_1'],
      ['requester_locationHistoryEntry', '/organization/org_1/project/proj_1/workspace/wrk_1/debug/request/req_2'],
      ['locationHistoryEntry', '/organization/org_1/project/proj_1/workspace/wrk_1/debug/request/req_2'],
      ['locationHistoryEntry:org_1', '/organization/org_1/project/proj_1/workspace/wrk_1/debug/request/req_2'],
    ]);
  });
});
