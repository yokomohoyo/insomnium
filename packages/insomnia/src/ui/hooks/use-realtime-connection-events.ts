import { useEffect, useRef, useState } from 'react';
import { useInterval } from 'react-use';

import { CurlEvent } from '../../main/network/curl';
import { WebSocketEvent } from '../../main/network/websocket';

export function useRealtimeConnectionEvents({ responseId, protocol }: { responseId: string; protocol: 'curl' | 'webSocket' }) {
  const [events, setEvents] = useState<CurlEvent[] | WebSocketEvent[]>([]);
  // the response shown, and how many of its events the window has, so only
  // the rest are sent over IPC
  const shown = useRef({ responseId, known: 0 });

  useEffect(() => {
    shown.current = { responseId, known: 0 };
    setEvents([]);
  }, [responseId]);

  useInterval(
    () => {
      let isMounted = true;
      const fn = async () => {
        const { total, added } = await window.main[protocol].event.findSince({ responseId, known: shown.current.known });
        if (isMounted && shown.current.responseId === responseId) {
          // kept as they were when nothing has come since, so the pane (which
          // sorts them all, and parses an LLM's stream) doesn't render again
          setEvents(current => {
            let next: (CurlEvent | WebSocketEvent)[] = current;
            if (current.length + added.length === total) {
              next = added.length ? [...added, ...current] : current;
            } else if (added.length === total) {
              // all of them: the log was written afresh
              next = added;
            }
            // (otherwise out of step with the poll before: the next one asks again)
            shown.current.known = next.length;
            return next as CurlEvent[] | WebSocketEvent[];
          });
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
