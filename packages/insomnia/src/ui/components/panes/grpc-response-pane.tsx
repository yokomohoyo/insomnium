import React, { FunctionComponent, useEffect, useRef } from 'react';

import { GrpcMessage, GrpcRequestState } from '../../routes/debug';
import { TabItem, Tabs } from '../base/tabs';
import { CodeEditor } from '../codemirror/code-editor';
import { GrpcStatusTag } from '../tags/grpc-status-tag';
import { Pane, PaneBody, PaneHeader } from './pane';
import { type GrpcMethodInfo } from '../../../main/ipc/grpc';
import type { GrpcMetadata } from '../../../main/network/grpc-metadata';
import { Timestamp } from '../timestamp';

interface Props {
  grpcState: GrpcRequestState;
}

const GrpcPaneHeader: FunctionComponent<Props> = ({ grpcState }) => (
  <PaneHeader className="row-spaced">
    <div className="no-wrap scrollable scrollable--no-bars pad-left">
      {grpcState.running && <i className='fa fa-refresh fa-spin margin-right-sm' />}
      {grpcState.status && <GrpcStatusTag statusCode={grpcState.status.code} statusMessage={grpcState.status.details} />}
      {!grpcState.status && grpcState.error && <GrpcStatusTag statusMessage={grpcState.error.message} />}
    </div>
  </PaneHeader>
);

const MetadataTable: FunctionComponent<{ label: string; metadata?: GrpcMetadata }> = ({ label, metadata }) => {
  const rows = Object.entries(metadata || {}).flatMap(([name, values]) => values.map((value, index) => ({ key: `${name}-${index}`, name, value })));
  return (
    <section aria-label={label} className="pad">
      <h2 className="txt-md no-margin-top">{label}</h2>
      {rows.length ? (
        <table className="table--fancy table--striped table--compact">
          <thead>
            <tr>
              <th>Name</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr className="selectable" key={row.key}>
                <td className="force-wrap">{row.name}</td>
                <td className="force-wrap">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="faint">None</p>}
    </section>
  );
};

// The response's headers (its initial metadata) and trailers
const GrpcMetadataView: FunctionComponent<Props> = ({ grpcState }) => (
  <div className="tall scrollable">
    <MetadataTable label="Headers" metadata={grpcState.headers} />
    <MetadataTable label="Trailers" metadata={grpcState.status?.metadata} />
  </div>
);

const hasResponse = ({ responseMessages, headers, status }: GrpcRequestState) => responseMessages.length > 0 || !!headers || !!status;

const GrpcUnaryResponsePane: FunctionComponent<Props> = ({ grpcState }) => {
  return (
    <Pane type="response">
      <GrpcPaneHeader grpcState={grpcState} />
      <PaneBody>
        {hasResponse(grpcState)
          ? (<Tabs aria-label="Grpc tabbed messages tabs" isNested>
            {[
              ...grpcState.responseMessages.map((m, index) => (
                <TabItem key={m.id} title={`Response ${index + 1}`}>
                  <CodeEditor
                    id="grpc-response"
                    defaultValue={m.text}
                    mode="application/json"
                    enableNunjucks
                    readOnly
                    autoPrettify
                  />
                </TabItem>)),
              <TabItem key="metadata" title="Metadata">
                <GrpcMetadataView grpcState={grpcState} />
              </TabItem>,
            ]}
          </Tabs>)
          : null
        }
      </PaneBody>
    </Pane>
  );
};

const TEXT_COLOR = "rgb(150 150 150)";
const BG_COLOR = "rgb(34 34 34)";
const BORDER_COLOR = "rgb(56 56 56)";

const GrpcStreamingResponseHeader: FunctionComponent<{ message: GrpcMessage }> = ({ message }) => {
  return (
    <div
      style={{
        width: "100%",
        backgroundColor: BG_COLOR,
        borderBottom: `1px solid ${BORDER_COLOR}`,
        padding: "0px 0px 3px 25px",
        color: TEXT_COLOR,
        fontStyle: "italic",
        fontSize: "8pt",
        paddingTop: "2px",
      }}
    >
      Received at: <Timestamp time={message.created} />
    </div>
  );
};

const GrpcStreamingResponsePane: FunctionComponent<Props> = ({ grpcState }) => {
  const messagesBottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesBottom.current?.scrollIntoView();
  });

  return (
    <Pane type="response">
      <GrpcPaneHeader grpcState={grpcState} />
      <PaneBody>
        <Tabs aria-label="Grpc streaming response tabs" isNested>
          <TabItem key="messages" title="Messages">
            <div style={{ height: "100%", overflow:"scroll" }}>
              {grpcState.responseMessages.map(m => (
                <div key={m.id} style={{ borderBottom: `1px solid ${BORDER_COLOR}` }}>
                  <GrpcStreamingResponseHeader message={m} />
                  <CodeEditor
                    id="grpc-response"
                    defaultValue={m.text}
                    mode="application/json"
                    dynamicHeight
                    enableNunjucks
                    readOnly
                    hideFilter
                    autoPrettify
                  />
                </div>))}
                <div ref={messagesBottom} />
            </div>
          </TabItem>
          <TabItem key="metadata" title="Metadata">
            <GrpcMetadataView grpcState={grpcState} />
          </TabItem>
        </Tabs>
      </PaneBody>
    </Pane>
  );
};

export const GrpcResponsePane: FunctionComponent<Props> = ({ grpcState }) => {
  return grpcState.method && hasStreamingResponse(grpcState.method)
    ? <GrpcStreamingResponsePane grpcState={grpcState} />
    : <GrpcUnaryResponsePane grpcState={grpcState} />;
};

export function hasStreamingResponse(method: GrpcMethodInfo): boolean {
  return method.type === "server" || method.type === "bidi";
}
