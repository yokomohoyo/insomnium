import React, { FC, useRef } from 'react';

import { WebSocketRequest } from '../../../models/websocket-request';
import { useRequestSetter } from '../../hooks/use-request';
import { CodeEditor } from '../codemirror/code-editor';
import { HelpTooltip } from '../help-tooltip';

type Subscription = NonNullable<WebSocketRequest['graphqlSubscription']>;

// A GraphQL subscription for a WebSocket request: started when it connects,
// with the graphql-transport-ws protocol (main/network/graphql-ws.ts), and
// each event comes in as a message.
export const GraphqlSubscriptionEditor: FC<{ request: WebSocketRequest; disabled: boolean }> = ({ request, disabled }) => {
  const patchRequest = useRequestSetter();
  // the latest, so an edit to one field doesn't undo a quick edit to another
  const latest = useRef<Subscription>(request.graphqlSubscription || { enabled: false, query: '', variables: '' });
  const update = (patch: Partial<Subscription>) => {
    latest.current = { ...latest.current, ...patch };
    patchRequest(request._id, { graphqlSubscription: latest.current });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 pad-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="Subscribe when connected"
            defaultChecked={latest.current.enabled}
            disabled={disabled}
            onChange={event => update({ enabled: event.currentTarget.checked })}
          />
          Subscribe when connected
        </label>
        <HelpTooltip>
          Connects with the graphql-transport-ws protocol, which Apollo, Hasura, GraphQL Yoga and others speak, and starts this subscription. Each event comes in as a message; the connection closes when the subscription completes.
        </HelpTooltip>
      </div>
      <div className="flex-1 min-h-0 relative">
        <CodeEditor
          id="graphql-subscription-query"
          uniquenessKey={`${request._id}::query`}
          mode="graphql"
          defaultValue={latest.current.query}
          placeholder="subscription { ... }"
          readOnly={disabled}
          onChange={query => update({ query })}
          enableNunjucks
        />
      </div>
      <div className="pad-sm txt-sm faint">Variables</div>
      <div className="h-32 relative">
        <CodeEditor
          id="graphql-subscription-variables"
          uniquenessKey={`${request._id}::variables`}
          mode="application/json"
          defaultValue={latest.current.variables}
          placeholder={'{ "id": 1 }'}
          readOnly={disabled}
          onChange={variables => update({ variables })}
          enableNunjucks
        />
      </div>
    </div>
  );
};
