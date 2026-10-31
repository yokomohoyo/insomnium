import { useEffect, useRef, useState } from 'react';
import { useRevalidator } from 'react-router-dom';

export function useReadyState({ requestId, protocol }: { requestId: string; protocol: 'curl' | 'webSocket' }): boolean {
  const [readyState, setReadyState] = useState<boolean>(false);

  // get readyState when requestId or protocol changes
  useEffect(() => {
    let isMounted = true;
    const fn = async () => {
      window.main[protocol].readyState.getCurrent({ requestId })
        .then((currentReadyState: boolean) => {
          isMounted && setReadyState(currentReadyState);
        });
    };
    fn();
    return () => {
      isMounted = false;
    };
  }, [protocol, requestId]);
  // listen for readyState changes
  useEffect(() => {
    let isMounted = true;
    const unsubscribe = window.main.on(`${protocol}.${requestId}.readyState`,
      (_, incomingReadyState: boolean) => {
        isMounted && setReadyState(incomingReadyState);
      });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [protocol, requestId]);

  return readyState;
}

// A connection opened elsewhere (an MCP client's connect_websocket or
// connect_event_stream) starts a new response: load it when the connection
// opens, as connecting here does. For the request's own pane, not every
// indicator of the state.
export function useShowConnectionWhenOpened(readyState: boolean) {
  const { revalidate } = useRevalidator();
  const wasOpen = useRef(readyState);
  useEffect(() => {
    if (readyState && !wasOpen.current) {
      revalidate();
    }
    wasOpen.current = readyState;
  }, [readyState, revalidate]);
}
