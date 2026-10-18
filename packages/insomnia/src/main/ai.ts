// The AI assistant's model: any chat model behind an OpenAI-compatible API,
// set in Preferences → AI. That's Ollama, LM Studio, llama.cpp or vLLM on your
// own computer, or OpenAI, Anthropic, Gemini, OpenRouter and others with a key.
// Nothing is sent until you ask for a suggestion, and then only what that
// feature says it sends. Requests go through the app's proxy settings.
import * as models from '../models';
import { axiosRequest } from './network/axios-request';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const aiEndpoint = (baseUrl: string, path: string) => `${baseUrl.trim().replace(/\/+$/, '')}/${path}`;

const TIMEOUT_MS = 120_000;

async function configured() {
  const settings = await models.settings.getOrCreate();
  if (!settings.aiBaseUrl?.trim() || !settings.aiModel?.trim()) {
    throw new Error('Set up the AI assistant first, in Preferences → AI');
  }
  return settings;
}

const headers = (apiKey: string) => ({
  'Content-Type': 'application/json',
  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
});

// what the endpoint said went wrong, as OpenAI-compatible APIs report it
const failure = (status: number, data: any) => {
  const detail = data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || data?.message || (typeof data === 'string' ? data.slice(0, 300) : '');
  return new Error(`The model's endpoint answered ${status}${detail ? `: ${detail}` : ''}`);
};

// A reply to the conversation, without a reasoning model's <think> section
export async function aiChat({ messages }: { messages: ChatMessage[] }): Promise<string> {
  const settings = await configured();
  const response = await axiosRequest({
    method: 'POST',
    url: aiEndpoint(settings.aiBaseUrl, 'chat/completions'),
    headers: headers(settings.aiApiKey),
    data: { model: settings.aiModel.trim(), messages, temperature: 0.2, stream: false },
    timeout: TIMEOUT_MS,
    validateStatus: () => true,
  });
  if (response.status >= 400) {
    throw failure(response.status, response.data);
  }
  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('The model sent an empty reply');
  }
  return content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '').trim();
}

// The models the endpoint offers, to choose from
export async function aiModels(): Promise<string[]> {
  const settings = await models.settings.getOrCreate();
  if (!settings.aiBaseUrl?.trim()) {
    throw new Error('Enter the endpoint first');
  }
  const response = await axiosRequest({
    method: 'GET',
    url: aiEndpoint(settings.aiBaseUrl, 'models'),
    headers: headers(settings.aiApiKey),
    timeout: 30_000,
    validateStatus: () => true,
  });
  if (response.status >= 400) {
    throw failure(response.status, response.data);
  }
  const listed: unknown[] = Array.isArray(response.data?.data) ? response.data.data : [];
  return listed
    .map(model => (model && typeof model === 'object' ? (model as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === 'string')
    .sort((a, b) => a.localeCompare(b));
}

export interface AiBridgeAPI {
  chat: (options: { messages: ChatMessage[] }) => Promise<string>;
  models: () => Promise<string[]>;
}
