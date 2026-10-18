import React, { FC, useRef } from 'react';

import { WebSocketRequest } from '../../../models/websocket-request';
import { useRequestSetter } from '../../hooks/use-request';
import { CodeEditor } from '../codemirror/code-editor';
import { HelpTooltip } from '../help-tooltip';

type SocketIo = NonNullable<WebSocketRequest['socketIo']>;

export const emptySocketIo = (): SocketIo => ({ enabled: false, namespace: '/', auth: '', event: 'message' });

// Socket.IO for a WebSocket request (main/network/socket-io.ts): on, which
// namespace to connect to, and the auth to connect with
export const SocketIoEditor: FC<{ request: WebSocketRequest; disabled: boolean }> = ({ request, disabled }) => {
  const patchRequest = useRequestSetter();
  // the latest, so an edit to one field doesn't undo a quick edit to another
  const latest = useRef<SocketIo>(request.socketIo || emptySocketIo());
  const update = (patch: Partial<SocketIo>) => {
    latest.current = { ...latest.current, ...patch };
    patchRequest(request._id, { socketIo: latest.current });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 pad-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="Use Socket.IO"
            defaultChecked={latest.current.enabled}
            disabled={disabled}
            onChange={event => update({ enabled: event.currentTarget.checked })}
          />
          Use Socket.IO
        </label>
        <HelpTooltip>
          Speaks Socket.IO (v3 and v4) over the WebSocket: the URL can be the server&apos;s address (http://localhost:3000), and /socket.io/ is added. Messages are sent as the event named in the message editor, with the JSON there as its arguments (an array is the arguments).
        </HelpTooltip>
      </div>
      <label className="pad-sm txt-sm">
        Namespace
        <input
          type="text"
          aria-label="Socket.IO namespace"
          className="w-full"
          defaultValue={latest.current.namespace}
          placeholder="/"
          disabled={disabled}
          onChange={event => update({ namespace: event.currentTarget.value })}
        />
      </label>
      <div className="pad-sm txt-sm faint">Auth (JSON, sent with the connect)</div>
      <div className="flex-1 min-h-0 relative">
        <CodeEditor
          id="socket-io-auth"
          uniquenessKey={`${request._id}::socket-io-auth`}
          mode="application/json"
          defaultValue={latest.current.auth}
          placeholder={'{ "token": "{{ token }}" }'}
          readOnly={disabled}
          onChange={auth => update({ auth })}
          enableNunjucks
        />
      </div>
    </div>
  );
};
