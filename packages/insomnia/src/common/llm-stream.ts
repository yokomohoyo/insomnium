// A language model's streamed reply, read from an Event Stream response: the
// text as it was put together, the model, why it stopped, the tokens it used,
// and how long it took to start and to finish. It reads OpenAI-compatible chat
// completions (OpenAI, Ollama, LM Studio, vLLM, OpenRouter, Gemini's), OpenAI's
// Responses API, and Anthropic's Messages API.

export interface ServerSentEvent {
  event: string;
  data: string;
  // when its last chunk arrived
  timestamp: number;
}

export interface StreamChunk {
  data: string;
  timestamp: number;
}

// The events in a stream's chunks, which can split an event or hold several
export function parseServerSentEvents(chunks: StreamChunk[]): ServerSentEvent[] {
  const events: ServerSentEvent[] = [];
  let buffer = '';
  let event = '';
  let data: string[] = [];
  const dispatch = (timestamp: number) => {
    if (data.length) {
      events.push({ event: event || 'message', data: data.join('\n'), timestamp });
    }
    event = '';
    data = [];
  };
  for (const chunk of chunks) {
    buffer += chunk.data;
    // nothing ends in it: splitting what's put together so far again, for each
    // of an event's many chunks, took seconds
    if (!/[\r\n]/.test(chunk.data)) {
      continue;
    }
    const lines = buffer.split(/\r\n|\r|\n/);
    // the last line may be cut off; it's finished by the next chunk
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line === '') {
        dispatch(chunk.timestamp);
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') {
          event = value;
        } else if (field === 'data') {
          data.push(value);
        }
      }
    }
  }
  if (buffer) {
    // a stream that ended without a final blank line
    const colon = buffer.indexOf(':');
    if (buffer.slice(0, colon) === 'data') {
      data.push(buffer.slice(colon + 1).replace(/^ /, ''));
    }
  }
  dispatch(chunks.length ? chunks[chunks.length - 1].timestamp : 0);
  return events;
}

export interface LlmUsage {
  input?: number;
  output?: number;
  total?: number;
}

export interface LlmStream {
  api: 'chat-completions' | 'responses' | 'anthropic';
  model?: string;
  text: string;
  // a reasoning model's thinking, when the API streams it apart
  reasoning: string;
  finishReason?: string;
  usage?: LlmUsage;
  // the events with a part of the reply
  deltas: number;
  // milliseconds from the stream's start to the first part of the reply, and to its end
  firstTokenMs?: number;
  totalMs?: number;
  // output tokens a second, after the first
  tokensPerSecond?: number;
  error?: string;
}

const json = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

// The reply in a stream's events, or null when they aren't a model's
export function readLlmStream(events: ServerSentEvent[], startedAt?: number): LlmStream | null {
  // set by start(), from inside the loop's branches
  const state: { stream: LlmStream | null } = { stream: null };
  let firstDeltaAt: number | undefined;
  let lastAt: number | undefined;
  const start = (api: LlmStream['api']) => (state.stream ||= { api, text: '', reasoning: '', deltas: 0 });
  const delta = (current: LlmStream, at: number, text: string, kind: 'text' | 'reasoning' = 'text') => {
    if (!text) {
      return;
    }
    current[kind] += text;
    current.deltas++;
    firstDeltaAt ??= at;
    lastAt = at;
  };

  for (const { event, data, timestamp } of events) {
    if (data.trim() === '[DONE]') {
      lastAt = timestamp;
      continue;
    }
    const value = json(data);
    if (!value || typeof value !== 'object') {
      continue;
    }
    // Anthropic: message_start, content_block_delta, message_delta
    const type = typeof value.type === 'string' ? value.type : event;
    if (type === 'message_start' && value.message) {
      const current = start('anthropic');
      current.model = value.message.model;
      current.usage = { ...current.usage, input: count(value.message.usage?.input_tokens) };
    } else if (type === 'content_block_delta' && value.delta) {
      const current = start('anthropic');
      delta(current, timestamp, value.delta.text || '', 'text');
      delta(current, timestamp, value.delta.thinking || '', 'reasoning');
    } else if (type === 'message_delta') {
      const current = start('anthropic');
      current.finishReason = value.delta?.stop_reason ?? current.finishReason;
      current.usage = { ...current.usage, output: count(value.usage?.output_tokens) ?? current.usage?.output };
      lastAt = timestamp;
    } else if (type === 'error' && value.error) {
      start(state.stream ? state.stream.api : 'anthropic').error = value.error.message || JSON.stringify(value.error);
    } else if (type.startsWith('response.')) {
      // OpenAI's Responses API
      const current = start('responses');
      if (type === 'response.output_text.delta') {
        delta(current, timestamp, String(value.delta || ''));
      } else if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
        delta(current, timestamp, String(value.delta || ''), 'reasoning');
      } else if (value.response) {
        current.model = value.response.model ?? current.model;
        if (value.response.status && value.response.status !== 'in_progress') {
          current.finishReason = value.response.status;
        }
        const usage = value.response.usage;
        if (usage) {
          current.usage = { input: count(usage.input_tokens), output: count(usage.output_tokens), total: count(usage.total_tokens) };
        }
        if (type === 'response.failed' && value.response.error) {
          current.error = value.response.error.message;
        }
      }
    } else if (Array.isArray(value.choices) || value.object === 'chat.completion.chunk') {
      // chat completions, from OpenAI and the many APIs like it
      const current = start('chat-completions');
      current.model = value.model ?? current.model;
      for (const choice of value.choices || []) {
        if (choice?.index !== undefined && choice.index !== 0) {
          continue;
        }
        delta(current, timestamp, choice?.delta?.content || '');
        delta(current, timestamp, choice?.delta?.reasoning_content || choice?.delta?.reasoning || '', 'reasoning');
        current.finishReason = choice?.finish_reason ?? current.finishReason;
      }
      if (value.usage) {
        current.usage = { input: count(value.usage.prompt_tokens), output: count(value.usage.completion_tokens), total: count(value.usage.total_tokens) };
      }
      lastAt = timestamp;
    } else if (value.error && state.stream) {
      state.stream.error = value.error.message || JSON.stringify(value.error);
    }
  }

  const result = state.stream;
  if (!result) {
    return null;
  }
  if (result.usage && result.usage.total === undefined && result.usage.input !== undefined && result.usage.output !== undefined) {
    result.usage.total = result.usage.input + result.usage.output;
  }
  if (startedAt !== undefined && firstDeltaAt !== undefined) {
    result.firstTokenMs = firstDeltaAt - startedAt;
  }
  if (startedAt !== undefined && lastAt !== undefined) {
    result.totalMs = lastAt - startedAt;
  }
  const output = result.usage?.output;
  if (output && firstDeltaAt !== undefined && lastAt !== undefined && lastAt > firstDeltaAt) {
    result.tokensPerSecond = Math.round((output / ((lastAt - firstDeltaAt) / 1000)) * 10) / 10;
  }
  return result;
}
