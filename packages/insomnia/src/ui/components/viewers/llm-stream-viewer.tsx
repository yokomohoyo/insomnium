import React, { FC } from 'react';

import type { LlmStream } from '../../../common/llm-stream';

const API_NAMES: Record<LlmStream['api'], string> = {
  'chat-completions': 'Chat Completions',
  responses: 'Responses',
  anthropic: 'Anthropic Messages',
};

const seconds = (ms?: number) => (ms === undefined ? '–' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);

// A model's streamed reply, put together, with what it cost and how fast it came
export const LlmStreamViewer: FC<{ stream: LlmStream }> = ({ stream }) => (
  <div className="pad selectable" data-testid="llm-stream">
    <dl className="txt-sm" style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 'var(--padding-xs) var(--padding-md)', margin: 0 }}>
      <dt className="faint">Model</dt>
      <dd className="m-0">{stream.model || '–'} <span className="faint">({API_NAMES[stream.api]})</span></dd>
      <dt className="faint">Tokens</dt>
      <dd className="m-0" data-testid="llm-usage">
        {stream.usage
          ? `${stream.usage.input ?? '?'} in · ${stream.usage.output ?? '?'} out · ${stream.usage.total ?? '?'} total`
          : 'not reported (ask for them, such as "stream_options": { "include_usage": true })'}
      </dd>
      <dt className="faint">First token</dt>
      <dd className="m-0" data-testid="llm-first-token">{seconds(stream.firstTokenMs)}</dd>
      <dt className="faint">Whole reply</dt>
      <dd className="m-0">
        {seconds(stream.totalMs)}
        {stream.tokensPerSecond !== undefined && <span className="faint"> · {stream.tokensPerSecond} tokens/s</span>}
      </dd>
      <dt className="faint">Stopped</dt>
      <dd className="m-0">{stream.finishReason || (stream.error ? 'with an error' : 'not yet')}</dd>
    </dl>
    {stream.error && <p className="notice error">{stream.error}</p>}
    {stream.reasoning && (
      <details className="margin-top">
        <summary className="faint pointer">Reasoning</summary>
        <div className="faint" style={{ whiteSpace: 'pre-wrap' }}>{stream.reasoning}</div>
      </details>
    )}
    <div className="margin-top" style={{ whiteSpace: 'pre-wrap' }} data-testid="llm-text">{stream.text}</div>
  </div>
);
