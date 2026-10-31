import React, { FC, useEffect, useRef, useState } from 'react';
import { useParams, useRouteLoaderData } from 'react-router-dom';

import type { McpServerSummary } from '../../../main/network/mcp-client';
import { tryToInterpolateRequestOrShowRenderErrorModal } from '../../../utils/try-interpolate';
import { useRequestSetter } from '../../hooks/use-request';
import { McpRequestLoaderData } from '../../routes/request';
import { TabItem, Tabs } from '../base/tabs';
import { CodeEditor, CodeEditorHandle } from '../codemirror/code-editor';
import { Pane, PaneHeader } from '../panes/pane';
import { argumentsSkeleton } from './arguments';
import { mcpErrorMessage, useMcpConnection } from './mcp-connection';

type Kind = 'tool' | 'prompt' | 'resource';

const Explorer: FC<{ kind: Kind; server: McpServerSummary; environmentId: string }> = ({ kind, server, environmentId }) => {
  const { activeRequest } = useRouteLoaderData('request/:requestId') as McpRequestLoaderData;
  const { requestId } = useParams() as { requestId: string };
  const patchRequest = useRequestSetter();
  const items: { name: string; uri?: string; description?: string }[] = kind === 'tool' ? server.tools : kind === 'prompt' ? server.prompts : server.resources;
  const keyOf = (item: (typeof items)[number]) => item.uri || item.name;
  const [chosen, setChosen] = useState(items[0] ? keyOf(items[0]) : '');
  const item = items.find(other => keyOf(other) === chosen);
  const [result, setResult] = useState<{ text: string; isError: boolean }>();
  const [calling, setCalling] = useState(false);
  const argsRef = useRef<CodeEditorHandle>(null);

  const savedArgs = (name: string) => activeRequest.toolArguments?.[`${kind}:${name}`];
  const startingArgs = () => {
    if (!item || kind === 'resource') {
      return '';
    }
    if (kind === 'tool') {
      return savedArgs(chosen) ?? argumentsSkeleton(server.tools.find(tool => tool.name === chosen)?.inputSchema as Parameters<typeof argumentsSkeleton>[0]);
    }
    const promptArgs = server.prompts.find(prompt => prompt.name === chosen)?.arguments || [];
    return savedArgs(chosen) ?? JSON.stringify(Object.fromEntries(promptArgs.map(arg => [arg.name, ''])), null, 2);
  };
  useEffect(() => {
    argsRef.current?.setValue(startingArgs());
    setResult(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the chosen item's
  }, [chosen]);

  if (!items.length) {
    return <div className="pad faint">This server has no {kind}s.</div>;
  }

  const call = async () => {
    setCalling(true);
    try {
      let args: Record<string, any> = {};
      if (kind !== 'resource') {
        const text = argsRef.current?.getValue() || '';
        patchRequest(requestId, { toolArguments: { ...activeRequest.toolArguments, [`${kind}:${chosen}`]: text } });
        const rendered = text.trim() ? await tryToInterpolateRequestOrShowRenderErrorModal({ request: activeRequest, environmentId, payload: text }) : '{}';
        args = JSON.parse(rendered);
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          throw new Error('The arguments have to be a JSON object');
        }
      }
      const response = kind === 'tool'
        ? await window.main.mcpClient.call({ requestId, kind, name: chosen, args })
        : kind === 'prompt'
          ? await window.main.mcpClient.call({ requestId, kind, name: chosen, args: Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)])) })
          : await window.main.mcpClient.call({ requestId, kind, uri: chosen });
      setResult({ text: JSON.stringify(response, null, 2), isError: Boolean((response as { isError?: boolean }).isError) });
    } catch (err) {
      setResult({ text: mcpErrorMessage(err), isError: true });
    } finally {
      setCalling(false);
    }
  };

  const description = item?.description || '';
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center gap-2 pad-sm">
        <select aria-label={`MCP ${kind}`} value={chosen} onChange={event => setChosen(event.currentTarget.value)} className="flex-1 min-w-0">
          {items.map(other => <option key={keyOf(other)} value={keyOf(other)}>{other.uri ? `${other.name} (${other.uri})` : other.name}</option>)}
        </select>
        <button type="button" className="btn btn--clicky" disabled={calling || !item} onClick={call}>
          {calling ? 'Calling…' : kind === 'tool' ? 'Call' : kind === 'prompt' ? 'Get' : 'Read'}
        </button>
      </div>
      {description && <p className="pad-left pad-right txt-sm no-margin-top selectable">{description}</p>}
      {kind !== 'resource' && (
        <>
          <div className="pad-left txt-sm faint">Arguments (JSON; variables and tags work)</div>
          <div className="h-40 relative flex-shrink-0">
            <CodeEditor id={`mcp-${kind}-arguments`} ref={argsRef} mode="application/json" defaultValue={startingArgs()} enableNunjucks />
          </div>
        </>
      )}
      {result && (
        <>
          <div className={`pad-left pad-top-sm txt-sm ${result.isError ? 'danger' : 'faint'}`} data-testid="mcp-result-label">
            {result.isError ? 'Error' : 'Result'}
          </div>
          <div className="flex-1 min-h-[10rem] relative" data-testid="mcp-result">
            <CodeEditor id={`mcp-${kind}-result`} key={result.text} mode="application/json" defaultValue={result.text} readOnly />
          </div>
        </>
      )}
    </div>
  );
};

// What the connected server offers, to call; or why it isn't connected
export const McpResponsePane: FC<{ environmentId: string }> = ({ environmentId }) => {
  const { requestId } = useParams() as { requestId: string };
  const connection = useMcpConnection(requestId);

  if (connection.status !== 'connected') {
    return (
      <Pane type="response">
        <div className="pad" data-testid="mcp-status">
          {connection.status === 'connecting' && <p><i className="fa fa-spinner fa-spin space-right" />Connecting…</p>}
          {connection.status === 'disconnected' && connection.error && <p className="danger selectable">{connection.error}</p>}
          {connection.status === 'disconnected' && !connection.error && (
            <p className="faint">Connect to see the server&apos;s tools, prompts and resources, and try them.</p>
          )}
        </div>
      </Pane>
    );
  }

  const { server } = connection;
  return (
    <Pane type="response">
      <PaneHeader className="row-spaced">
        <div className="pad-left txt-sm" data-testid="mcp-server">
          <strong>{server.name || 'MCP server'}</strong> {server.version} <span className="faint">over {server.transport}</span>
        </div>
      </PaneHeader>
      <Tabs aria-label="MCP server">
        <TabItem key="tools" title={`Tools (${server.tools.length})`}>
          <Explorer key={`${requestId}::tools`} kind="tool" server={server} environmentId={environmentId} />
        </TabItem>
        <TabItem key="prompts" title={`Prompts (${server.prompts.length})`}>
          <Explorer key={`${requestId}::prompts`} kind="prompt" server={server} environmentId={environmentId} />
        </TabItem>
        <TabItem key="resources" title={`Resources (${server.resources.length})`}>
          <Explorer key={`${requestId}::resources`} kind="resource" server={server} environmentId={environmentId} />
        </TabItem>
        <TabItem key="instructions" title="Instructions">
          <div className="pad selectable" style={{ whiteSpace: 'pre-wrap' }}>
            {server.instructions || <span className="faint">The server gave no instructions.</span>}
          </div>
        </TabItem>
      </Tabs>
    </Pane>
  );
};
