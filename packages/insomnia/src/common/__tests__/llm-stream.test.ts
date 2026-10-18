import { describe, expect, it } from '@jest/globals';

import { parseServerSentEvents, readLlmStream } from '../llm-stream';

// a stream's text cut into chunks at the given places, a chunk every 100 ms from 1000
const chunked = (text: string, ...cuts: number[]) => [0, ...cuts, text.length].slice(0, -1)
  .map((start, index, starts) => ({ data: text.slice(start, starts[index + 1] ?? text.length), timestamp: 1000 + (index + 1) * 100 }));

describe('parseServerSentEvents()', () => {
  it('reads events split over chunks, and several in one, with names and multi-line data', () => {
    const text = 'event: ping\ndata: one\n\n: a comment\ndata: two\ndata: lines\r\n\r\ndata:three';
    expect(parseServerSentEvents(chunked(text, 8, 20, 30)).map(({ event, data }) => ({ event, data }))).toEqual([
      { event: 'ping', data: 'one' },
      { event: 'message', data: 'two\nlines' },
      { event: 'message', data: 'three' },
    ]);
  });
});

describe('readLlmStream()', () => {
  it('puts together a chat completion, with its usage and timing', () => {
    const text = [
      { model: 'gpt-4o-mini', choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
      { model: 'gpt-4o-mini', choices: [{ index: 0, delta: { content: 'Hello' } }] },
      { model: 'gpt-4o-mini', choices: [{ index: 0, delta: { content: ', world' }, finish_reason: 'stop' }] },
      { model: 'gpt-4o-mini', choices: [], usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } },
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    const events = parseServerSentEvents(text.split(/(?<=\n\n)/).map((data, index) => ({ data, timestamp: 1000 + index * 100 })));

    expect(readLlmStream(events, 900)).toEqual({
      api: 'chat-completions',
      model: 'gpt-4o-mini',
      text: 'Hello, world',
      reasoning: '',
      finishReason: 'stop',
      usage: { input: 9, output: 3, total: 12 },
      deltas: 2,
      firstTokenMs: 200,
      totalMs: 500,
      tokensPerSecond: 10,
    });
  });

  it("reads Anthropic's events, thinking apart", () => {
    const events = [
      ['message_start', { type: 'message_start', message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 20 } } }],
      ['content_block_delta', { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Hm.' } }],
      ['content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }],
    ].map(([event, data], index) => ({ event: event as string, data: JSON.stringify(data), timestamp: index * 100 }));

    expect(readLlmStream(events, 0)).toMatchObject({ api: 'anthropic', model: 'claude-sonnet-5-5', text: 'Hi', reasoning: 'Hm.', finishReason: 'end_turn', usage: { input: 20, output: 4, total: 24 } });
  });

  it("reads OpenAI's Responses API", () => {
    const events = [
      { type: 'response.created', response: { model: 'gpt-5', status: 'in_progress' } },
      { type: 'response.output_text.delta', delta: 'Yes' },
      { type: 'response.completed', response: { model: 'gpt-5', status: 'completed', usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 } } },
    ].map((data, index) => ({ event: data.type, data: JSON.stringify(data), timestamp: index }));

    expect(readLlmStream(events)).toMatchObject({ api: 'responses', model: 'gpt-5', text: 'Yes', finishReason: 'completed', usage: { input: 5, output: 1, total: 6 } });
  });

  it("is null for a stream that isn't a model's, and says what went wrong in one that is", () => {
    expect(readLlmStream([{ event: 'message', data: 'tick 1', timestamp: 0 }, { event: 'update', data: '{"price": 3}', timestamp: 1 }])).toBeNull();
    const failed = readLlmStream([
      { event: 'message', data: JSON.stringify({ choices: [{ index: 0, delta: { content: 'Par' } }] }), timestamp: 0 },
      { event: 'message', data: JSON.stringify({ error: { message: 'overloaded' } }), timestamp: 1 },
    ]);
    expect(failed).toMatchObject({ text: 'Par', error: 'overloaded' });
  });
});
