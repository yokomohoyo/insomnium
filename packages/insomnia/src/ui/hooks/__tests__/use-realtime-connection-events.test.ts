import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useMemo } from 'react';

import { useRealtimeConnectionEvents } from '../use-realtime-connection-events';

describe('useRealtimeConnectionEvents()', () => {
  let log: { _id: string }[];
  let asked: number[];

  beforeEach(() => {
    jest.useFakeTimers();
    log = [{ _id: 'b' }, { _id: 'a' }];
    asked = [];
    // a copy each time, as one over IPC is; the log is latest first
    const findSince = async ({ known }: { known: number }) => {
      asked.push(known);
      const from = known <= log.length ? known : 0;
      return { total: log.length, added: log.slice(0, log.length - from).map(event => ({ ...event })) };
    };
    window.main = { curl: { event: { findSince } } } as unknown as Window['main'];
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

  it('asks only for the events it does not have', async () => {
    const { result } = renderHook(() => useRealtimeConnectionEvents({ responseId: 'res_1', protocol: 'curl' }));
    await poll();
    log = [{ _id: 'd' }, { _id: 'c' }, ...log];
    await poll();
    await poll();

    expect(asked).toEqual([0, 2, 4]);
    expect(result.current.map(event => event._id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('takes them all again when the log was written afresh', async () => {
    const { result } = renderHook(() => useRealtimeConnectionEvents({ responseId: 'res_1', protocol: 'curl' }));
    await poll();

    log = [{ _id: 'x' }];
    await poll();

    expect(result.current.map(event => event._id)).toEqual(['x']);
  });

  it('starts over for another response', async () => {
    const { result, rerender } = renderHook(({ responseId }) => useRealtimeConnectionEvents({ responseId, protocol: 'curl' }), { initialProps: { responseId: 'res_1' } });
    await poll();
    log = [{ _id: 'z' }, { _id: 'y' }, { _id: 'x' }];

    rerender({ responseId: 'res_2' });
    await poll();

    expect(asked.at(-1)).toBe(0);
    expect(result.current.map(event => event._id)).toEqual(['z', 'y', 'x']);
  });
});
