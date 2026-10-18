// What the AI assistant asks the model (main/ai.ts), and how its replies are
// read. Each prompt holds only what its feature says it sends: a description
// and variable names for a new request, names and changed fields for a commit
// message. Never variable values, header values or bodies.
import type { ChatMessage } from '../main/ai';
import type { DocDiff } from '../sync/git/doc-diff';

const MAX_VARIABLES = 100;
const MAX_CHANGES = 60;

// an environment's variable names as templates use them, a.b for nested ones
export function variableNames(...environments: (Record<string, any> | undefined)[]) {
  const names = new Set<string>();
  const walk = (data: Record<string, any>, prefix: string, depth: number) => {
    for (const [key, value] of Object.entries(data)) {
      if (!/^[A-Za-z_$][\w$]*$/.test(key)) {
        continue;
      }
      names.add(prefix + key);
      if (depth < 2 && value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, `${prefix}${key}.`, depth + 1);
      }
    }
  };
  environments.forEach(data => data && walk(data, '', 1));
  return [...names].slice(0, MAX_VARIABLES);
}

export function requestPrompt(description: string, variables: string[]): ChatMessage[] {
  return [{
    role: 'system',
    content: [
      'You turn a description of an HTTP request into a request for an API client.',
      'Reply with only a JSON object, and no other text, like:',
      '{"name": "Create order", "method": "POST", "url": "https://api.example.com/orders?notify=true", "headers": [{"name": "Accept", "value": "application/json"}], "body": {"mimeType": "application/json", "text": "{\\"sku\\": \\"A-1\\"}"}}',
      'Leave out "body" when the request has none. Put query parameters in the URL.',
      variables.length
        ? `These environment variables are defined. Where one fits, write it as {{ name }} instead of a literal value: ${variables.join(', ')}.`
        : 'No environment variables are defined.',
    ].join('\n'),
  }, {
    role: 'user',
    content: description.trim(),
  }];
}

export interface DescribedRequest {
  name?: string;
  method: string;
  url: string;
  headers: { name: string; value: string }[];
  body?: { mimeType: string; text: string };
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// The request in the model's reply: the JSON object in it, even with a code
// fence or a sentence around it
export function parseRequestReply(reply: string): DescribedRequest {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  let value: any;
  try {
    value = start >= 0 && end > start ? JSON.parse(reply.slice(start, end + 1)) : null;
  } catch {
    value = null;
  }
  const url = text(value?.url, 2000);
  if (!value || typeof value !== 'object' || !url) {
    throw new Error(`The model's reply wasn't a request: ${reply.slice(0, 200)}`);
  }
  const method = text(value.method, 20).toUpperCase();
  const headers = (Array.isArray(value.headers) ? value.headers : [])
    .filter((header: any) => header && typeof header.name === 'string' && header.name.trim())
    .map((header: any) => ({ name: text(header.name, 200), value: typeof header.value === 'string' ? header.value : String(header.value ?? '') }));
  const body = value.body && typeof value.body === 'object' && typeof value.body.text === 'string' && value.body.text
    ? { mimeType: text(value.body.mimeType, 100) || 'application/json', text: value.body.text }
    : undefined;
  return {
    ...(text(value.name, 100) ? { name: text(value.name, 100) } : {}),
    method: /^[A-Z]+$/.test(method) ? method : 'GET',
    url,
    headers,
    ...(body ? { body } : {}),
  };
}

export interface CommitChange {
  status: string;
  type: string;
  name: string;
  diff?: DocDiff;
}

// a line per change: what it is, and which fields changed
export function commitChangesSummary(changes: CommitChange[]) {
  const lines = changes.slice(0, MAX_CHANGES).map(change => {
    const what = change.status.includes('added') ? 'added' : change.status.includes('deleted') ? 'deleted' : 'modified';
    const fields = (change.diff?.changes || []).map(field => (field.detail ? `${field.field} (${field.detail})` : field.field));
    return `- ${what} ${change.type} "${change.name}"${fields.length ? `: ${fields.join(', ')}` : ''}`;
  });
  if (changes.length > MAX_CHANGES) {
    lines.push(`- and ${changes.length - MAX_CHANGES} more`);
  }
  return lines.join('\n');
}

export function commitPrompt(changes: CommitChange[]): ChatMessage[] {
  return [{
    role: 'system',
    content: [
      'You write git commit messages for changes to an API collection kept in git.',
      'Reply with only the message: a summary line in the imperative mood, under 72 characters, then, only if it helps, a blank line and a few short bullet lines.',
      'No quotes, no code fences, no preamble.',
    ].join('\n'),
  }, {
    role: 'user',
    content: `The changes:\n${commitChangesSummary(changes)}`,
  }];
}

// the message without a code fence or quotes around it
export const cleanCommitMessage = (reply: string) =>
  reply
    .trim()
    .replace(/^```[\w-]*\n([\s\S]*?)\n```$/, '$1')
    .replace(/^"([\s\S]*)"$/, '$1')
    .trim();
