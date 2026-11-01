import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useMemo } from 'react';

import { useRealtimeConnectionEvents } from '../use-realtime-connection-events';

describe('useRealtimeConnectionEvents()', () => {
  let log: { _id: string }[];

  beforeEach(() => {
    jest.useFakeTimers();
    log = [{ _id: 'b' }, { _id: 'a' }];
    // a copy each time, as one over IPC is
    window.main = { curl: { event: { findMany: async () => log.map(event => ({ ...event })) } } } as unknown as Window['main'];
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const poll = () => act(async () => {
    jest.advanceTimersByTime(500);
  });

  it("keeps the same events while nothing new comes, so the pane's work on them isn't done again", async () => {
    // as the pane sorts them all, and parses an LLM's stream
    let worked = 0;
    const { result } = renderHook(() => {
      const events = useRealtimeConnectionEvents({ responseId: 'res_1', protocol: 'curl' });
      useMemo(() => {
        worked++;
        return events.length;
      }, [events]);
      return events;
    });
    await poll();
    const first = result.current;
    expect(first.map(event => event._id)).toEqual(['b', 'a']);
    const before = worked;

    await poll();
    await poll();

    expect(result.current).toBe(first);
    expect(worked).toBe(before);

    log = [{ _id: 'c' }, ...log];
    await poll();

    expect(result.current.map(event => event._id)).toEqual(['c', 'b', 'a']);
  });
});
