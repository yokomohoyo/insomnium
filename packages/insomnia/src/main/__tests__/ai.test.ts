/**
 * @jest-environment node
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { aiChat, aiEndpoint, aiModels } from '../ai';

describe('the AI assistant client', () => {
  let server: http.Server;
  let baseUrl: string;
  const received: { method?: string; url?: string; authorization?: string; body: any }[] = [];
  let reply: { status: number; body: unknown };

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      let data = '';
      request.on('data', chunk => (data += chunk));
      request.on('end', () => {
        received.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body: data ? JSON.parse(data) : null });
        response.writeHead(reply.status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
  });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  beforeEach(async () => {
    await globalBeforeEach();
    received.length = 0;
    const settings = await models.settings.getOrCreate();
    await models.settings.update(settings, { aiBaseUrl: baseUrl, aiModel: 'llama3.2', aiApiKey: 'sk-test' });
  });

  it('asks the chat endpoint with the model and key, and answers with its reply', async () => {
    reply = { status: 200, body: { choices: [{ message: { role: 'assistant', content: '<think>Hm, pets.</think>\nAdd pets' } }] } };

    await expect(aiChat({ messages: [{ role: 'user', content: 'hello' }] })).resolves.toBe('Add pets');

    expect(received).toEqual([{
      method: 'POST',
      url: '/v1/chat/completions',
      authorization: 'Bearer sk-test',
      body: { model: 'llama3.2', messages: [{ role: 'user', content: 'hello' }], temperature: 0.2, stream: false },
    }]);
  });

  it("says what the endpoint said went wrong", async () => {
    reply = { status: 401, body: { error: { message: 'Incorrect API key provided' } } };
    await expect(aiChat({ messages: [] })).rejects.toThrow("The model's endpoint answered 401: Incorrect API key provided");

    reply = { status: 200, body: { choices: [] } };
    await expect(aiChat({ messages: [] })).rejects.toThrow('The model sent an empty reply');
  });

  it('lists the models the endpoint offers, and sends no key when there is none', async () => {
    const settings = await models.settings.getOrCreate();
    await models.settings.update(settings, { aiApiKey: '' });
    reply = { status: 200, body: { object: 'list', data: [{ id: 'qwen3' }, { id: 'llama3.2' }, { name: 'no id' }] } };

    await expect(aiModels()).resolves.toEqual(['llama3.2', 'qwen3']);
    expect(received[0]).toMatchObject({ method: 'GET', url: '/v1/models', authorization: undefined });
  });

  it("refuses before it's set up", async () => {
    const settings = await models.settings.getOrCreate();
    await models.settings.update(settings, { aiModel: '' });

    await expect(aiChat({ messages: [] })).rejects.toThrow('Set up the AI assistant first');
    expect(received).toEqual([]);
  });

  it('joins the endpoint and a path with one slash', () => {
    expect(aiEndpoint(' http://localhost:11434/v1// ', 'models')).toBe('http://localhost:11434/v1/models');
  });
});
