import { useEffect, useState } from 'react';
import { useInterval } from 'react-use';

import { CurlEvent } from '../../main/network/curl';
import { WebSocketEvent } from '../../main/network/websocket';

// the same events (latest first): a log only grows
const sameEvents = (a: (CurlEvent | WebSocketEvent)[], b: (CurlEvent | WebSocketEvent)[]) =>
  a.length === b.length && a[0]?._id === b[0]?._id;

export function useRealtimeConnectionEvents({ responseId, protocol }: { responseId: string; protocol: 'curl' | 'webSocket' }) {
  const [events, setEvents] = useState<CurlEvent[] | WebSocketEvent[]>([]);

  useEffect(() => {
    setEvents([]);
  }, [responseId]);

  useInterval(
    () => {
      let isMounted = true;
      const fn = async () => {
        const allEvents = await window.main[protocol].event.findMany({ responseId });
        if (isMounted) {
          // kept as they were when nothing has come since, so the pane (which
          // sorts them all, and parses an LLM's stream) doesn't render again
          setEvents(current => sameEvents(current, allEvents) ? current : allEvents);
        }
      };
      fn();
      return () => {
        isMounted = false;
      };
    },
    500
  );

  return events;
}
