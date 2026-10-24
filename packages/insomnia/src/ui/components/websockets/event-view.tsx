import React, { FC, useCallback } from 'react';
import { useParams, useRouteLoaderData } from 'react-router-dom';
import styled from 'styled-components';

import { PREVIEW_MODE_FRIENDLY, PREVIEW_MODE_RAW, PREVIEW_MODE_SOURCE, PreviewMode } from '../../../common/constants';
import { writeToFile } from '../../../common/write-to-file';
import { CurlEvent, CurlMessageEvent } from '../../../main/network/curl';
import { WebSocketEvent, WebSocketMessageEvent } from '../../../main/network/websocket';
import { hexDump, loggedBytes } from '../../../main/network/websocket-frames';
import { requestMeta } from '../../../models';
import { RequestLoaderData } from '../../routes/request';
import { CodeEditor } from '../codemirror/code-editor';
import { showError } from '../modals';
import { WebSocketPreviewModeDropdown } from './websocket-preview-dropdown';

interface Props<T extends WebSocketEvent> {
  event: T;
}

const PreviewPane = styled.div({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
});

const PreviewPaneButtons = styled.div({
  display: 'flex',
  flexDirection: 'row',
  boxSizing: 'border-box',
  height: 'var(--line-height-sm)',
  borderBottom: '1px solid var(--hl-lg)',
  padding: 'var(--padding-sm) var(--padding-md)',
});

const PreviewPaneContents = styled.div({
  padding: 'var(--padding-sm)',
  flexGrow: 1,
});

export const MessageEventView: FC<Props<CurlMessageEvent | WebSocketMessageEvent>> = ({ event }) => {
  const { requestId } = useParams() as { requestId: string };
  // a binary frame's bytes (base64 in the log, or Buffer's JSON in an older one)
  const bytes = loggedBytes(event as WebSocketMessageEvent);
  const raw = bytes ? bytes.toString() : event.data.toString();

  const handleDownloadResponseBody = useCallback(async () => {
    const { canceled, filePath: outputPath } = await window.dialog.showSaveDialog({
      title: 'Save Response Body',
      buttonLabel: 'Save',
    });

    if (canceled || !outputPath) {
      return;
    }

    const error = await writeToFile(outputPath, bytes ?? raw);
    if (error) {
      showError({
        title: 'Save Failed',
        message: `Failed to save to ${outputPath}: ${error.message}`,
        error,
      });
    }
  }, [bytes, raw]);

  const handleCopyResponseToClipboard = useCallback(() => {
    window.clipboard.writeText(bytes ? bytes.toString('base64') : raw);
  }, [bytes, raw]);

  const setPreviewMode = async (previewMode: PreviewMode) => {
    return requestMeta.updateOrCreateByParentId(requestId, { previewMode });
  };

  // TODO(johnwchadwick): Maybe shouldn't try if it's too large.
  // TODO(johnwchadwick): Should allow selecting a type instead of assuming JSON.
  let pretty = raw;
  try {
    const parsed = JSON.parse(raw);
    pretty = JSON.stringify(parsed, null, '\t');
  } catch {
    // Can't parse as JSON.
  }
  const { activeRequestMeta } = useRouteLoaderData('request/:requestId') as RequestLoaderData;
  const previewMode = activeRequestMeta.previewMode || PREVIEW_MODE_SOURCE;
  // bytes: a hex dump to preview, base64 as source, and as text when raw
  const shown = bytes
    ? { [PREVIEW_MODE_FRIENDLY]: hexDump(bytes), [PREVIEW_MODE_SOURCE]: bytes.toString('base64'), [PREVIEW_MODE_RAW]: raw }[previewMode] ?? hexDump(bytes)
    : previewMode === PREVIEW_MODE_FRIENDLY ? pretty : raw;
  return (
    <PreviewPane>
      <PreviewPaneButtons>
        <WebSocketPreviewModeDropdown
          download={handleDownloadResponseBody}
          copyToClipboard={handleCopyResponseToClipboard}
          previewMode={previewMode}
          setPreviewMode={setPreviewMode}
        />
      </PreviewPaneButtons>
      <PreviewPaneContents>
        <CodeEditor
          id="websocket-body-preview"
          hideLineNumbers
          mode={previewMode === PREVIEW_MODE_RAW || bytes ? 'text/plain' : 'text/json'}
          defaultValue={shown}
          uniquenessKey={`${event._id}-${previewMode}`}
          readOnly
        />
      </PreviewPaneContents>
    </PreviewPane>
  );
};

export const EventView: FC<Props<CurlEvent | WebSocketEvent>> = ({ event }) => {
  if (event.type === 'message') {
    return <MessageEventView event={event} />;
  }
  return null;
};
