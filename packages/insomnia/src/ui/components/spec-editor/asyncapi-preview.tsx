import React, { FC } from 'react';

import { type AsyncApiMessage, asyncApiOutline } from '../../../common/asyncapi';

const ACTION_LABELS: Record<string, string> = { send: 'SEND', receive: 'RECEIVE', publish: 'PUBLISH', subscribe: 'SUBSCRIBE' };

const Message: FC<{ message: AsyncApiMessage }> = ({ message }) => (
  <details className="pad-left-sm">
    <summary className="pointer">
      <span className="monospace">{message.name}</span>
      {message.contentType && <span className="faint txt-sm space-left">{message.contentType}</span>}
      {message.summary && <span className="faint space-left">{message.summary}</span>}
    </summary>
    {message.payload !== undefined && (
      <pre className="selectable txt-sm pad-sm" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(message.payload, null, 2)}</pre>
    )}
  </details>
);

// An AsyncAPI document's servers, channels, operations and messages
export const AsyncApiPreview: FC<{ contents: Record<string, any> }> = ({ contents }) => {
  const outline = asyncApiOutline(contents);
  return (
    <div className="pad selectable overflow-y-auto h-full" data-testid="asyncapi-preview">
      <h2 className="no-margin-top">
        {outline.title} <span className="faint txt-md">{outline.infoVersion}</span>
      </h2>
      <p className="faint txt-sm">AsyncAPI {outline.version}</p>
      {outline.description && <p style={{ whiteSpace: 'pre-wrap' }}>{outline.description}</p>}
      {outline.servers.length > 0 && (
        <section>
          <h3>Servers</h3>
          <ul aria-label="Servers">
            {outline.servers.map(server => (
              <li key={server.name}>
                <strong>{server.name}</strong> <span className="monospace">{server.url}</span> <span className="faint">{server.protocol}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <h3>Channels</h3>
      {outline.channels.length === 0 && <p className="faint">No channels.</p>}
      {outline.channels.map(channel => (
        <section key={channel.name} aria-label={channel.address} className="margin-bottom">
          <h4 className="monospace no-margin-bottom">{channel.address}</h4>
          {channel.description && <p className="faint" style={{ whiteSpace: 'pre-wrap' }}>{channel.description}</p>}
          {channel.operations.map(operation => (
            <div key={operation.id} className="pad-left">
              <p className="no-margin">
                <span className="tag bg-surprise">{ACTION_LABELS[operation.action] || operation.action.toUpperCase()}</span>{' '}
                <span className="monospace">{operation.id}</span>
                {operation.summary && <span className="faint space-left">{operation.summary}</span>}
              </p>
              {operation.messages.map(message => <Message key={message.name} message={message} />)}
            </div>
          ))}
          {channel.operations.length === 0 && channel.messages.map(message => <Message key={message.name} message={message} />)}
        </section>
      ))}
    </div>
  );
};
