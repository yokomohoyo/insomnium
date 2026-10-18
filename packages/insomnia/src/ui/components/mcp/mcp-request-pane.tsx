import React, { FC } from 'react';
import { useParams, useRouteLoaderData } from 'react-router-dom';

import type { McpTransport } from '../../../models/mcp-request';
import type { RequestHeader } from '../../../models/request';
import { tryToInterpolateRequestOrShowRenderErrorModal } from '../../../utils/try-interpolate';
import { useRequestSetter } from '../../hooks/use-request';
import { useActiveRequestSyncVCSVersion, useGitVCSVersion } from '../../hooks/use-vcs-version';
import { McpRequestLoaderData } from '../../routes/request';
import { TabItem, Tabs } from '../base/tabs';
import { OneLineEditor } from '../codemirror/one-line-editor';
import { RequestHeadersEditor } from '../editors/request-headers-editor';
import { useDocBodyKeyboardShortcuts } from '../keydown-binder';
import { showAlert, showModal } from '../modals';
import { AskModal } from '../modals/ask-modal';
import { Pane, PaneHeader } from '../panes/pane';
import { argsOf } from './arguments';
import { getMcpConnection, setMcpConnection, useMcpConnection } from './mcp-connection';

// The MCP request's connection settings: a server's URL over HTTP, or a
// command that runs one on this computer, asked about first every time.
export const McpRequestPane: FC<{ environmentId: string }> = ({ environmentId }) => {
  const { activeRequest } = useRouteLoaderData('request/:requestId') as McpRequestLoaderData;
  const { requestId } = useParams() as { requestId: string };
  const patchRequest = useRequestSetter();
  const connection = useMcpConnection(requestId);
  const gitVersion = useGitVCSVersion();
  const syncVersion = useActiveRequestSyncVCSVersion();
  const uniquenessKey = `${requestId}::${gitVersion}::${syncVersion}`;
  const busy = connection.status !== 'disconnected';

  const connect = async () => {
    if (getMcpConnection(requestId).status !== 'disconnected') {
      return;
    }
    const rendered = await tryToInterpolateRequestOrShowRenderErrorModal({
      request: activeRequest,
      environmentId,
      payload: {
        url: activeRequest.url,
        headers: activeRequest.headers,
        command: activeRequest.command,
        args: activeRequest.args,
      },
    });
    if (!rendered) {
      return;
    }
    const options = {
      requestId,
      transport: activeRequest.transport,
      url: rendered.url,
      headers: Object.fromEntries((rendered.headers as RequestHeader[]).filter(header => header.name && !header.disabled).map(header => [header.name, header.value])),
      command: rendered.command,
      args: argsOf(rendered.args),
    };
    const start = async () => {
      setMcpConnection(requestId, { status: 'connecting' });
      try {
        setMcpConnection(requestId, { status: 'connected', server: await window.main.mcpClient.connect(options) });
      } catch (err) {
        setMcpConnection(requestId, { status: 'disconnected', error: err instanceof Error ? err.message : String(err) });
      }
    };
    if (activeRequest.transport !== 'stdio') {
      start();
      return;
    }
    // a command from a collection could be anything: say what runs, every time
    showModal(AskModal, {
      title: 'Run the MCP Server?',
      message: (
        <div>
          <p>This runs a command on your computer, with your permissions:</p>
          <pre className="selectable pad-sm" style={{ whiteSpace: 'pre-wrap' }}>{[options.command, ...options.args].join(' ')}</pre>
          <p>Run it only if you trust it.</p>
        </div>
      ),
      yesText: 'Run',
      noText: 'Cancel',
      onDone: async (isYes: boolean) => {
        if (isYes) {
          start();
        }
      },
    });
  };
  const disconnect = () => window.main.mcpClient.disconnect({ requestId }).then(() => setMcpConnection(requestId, { status: 'disconnected' }));

  useDocBodyKeyboardShortcuts({
    request_send: () => (busy ? undefined : connect()),
  });

  return (
    <Pane type="request">
      <PaneHeader>
        <div className="flex items-stretch w-full h-full">
          <select
            aria-label="Transport"
            className="px-2 bg-transparent"
            value={activeRequest.transport}
            disabled={busy}
            onChange={event => patchRequest(requestId, { transport: event.currentTarget.value as McpTransport })}
          >
            <option value="http">HTTP</option>
            <option value="stdio">STDIO</option>
          </select>
          <div className="flex-1 min-w-0 flex items-center" title={activeRequest.transport === 'stdio' ? activeRequest.command : activeRequest.url}>
            {activeRequest.transport === 'stdio' ? (
              <OneLineEditor
                id="mcp-command"
                key={`${uniquenessKey}::command`}
                type="text"
                defaultValue={activeRequest.command}
                placeholder="npx -y @modelcontextprotocol/server-everything"
                readOnly={busy}
                onChange={command => patchRequest(requestId, { command })}
              />
            ) : (
              <OneLineEditor
                id="mcp-url"
                key={`${uniquenessKey}::url`}
                type="text"
                defaultValue={activeRequest.url}
                placeholder="https://example.com/mcp"
                readOnly={busy}
                onChange={url => patchRequest(requestId, { url })}
              />
            )}
          </div>
          {connection.status === 'disconnected' ? (
            <button className="urlbar__send-btn" type="button" onClick={connect}>Connect</button>
          ) : (
            <button className="urlbar__send-btn" type="button" onClick={disconnect}>
              {connection.status === 'connecting' ? 'Connecting…' : 'Disconnect'}
            </button>
          )}
        </div>
      </PaneHeader>
      <Tabs aria-label="MCP request pane tabs">
        {activeRequest.transport === 'stdio' ? (
          <TabItem key="arguments" title="Arguments">
            <div className="pad">
              <p className="txt-sm faint no-margin-top">
                The command&apos;s arguments, one per line; the command above can carry some too. It runs with your PATH and home folder, not the app&apos;s other environment variables.
              </p>
              <textarea
                aria-label="Arguments"
                key={`${uniquenessKey}::args`}
                className="w-full font-mono"
                rows={8}
                defaultValue={activeRequest.args}
                disabled={busy}
                onChange={event => patchRequest(requestId, { args: event.currentTarget.value })}
              />
            </div>
          </TabItem>
        ) : (
          <TabItem key="headers" title="Headers">
            <RequestHeadersEditor key={uniquenessKey} bulk={false} isDisabled={busy} />
          </TabItem>
        )}
        <TabItem key="docs" title="Docs">
          <div className="pad">
            <textarea
              aria-label="Description"
              key={`${uniquenessKey}::description`}
              className="w-full"
              rows={8}
              placeholder="What this server is for, in Markdown"
              defaultValue={activeRequest.description}
              onChange={event => patchRequest(requestId, { description: event.currentTarget.value })}
            />
          </div>
        </TabItem>
      </Tabs>
    </Pane>
  );
};

export const showMcpError = (title: string, error: unknown) =>
  showAlert({ title, message: error instanceof Error ? error.message : String(error) });
