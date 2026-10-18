import { describe, expect, it } from '@jest/globals';

import { cleanCommitMessage, commitChangesSummary, commitPrompt, parseRequestReply, requestPrompt, variableNames } from '../ai-prompts';

describe('variableNames()', () => {
  it('lists names as templates use them, and never values', () => {
    const names = variableNames({ base_url: 'https://api.example.com', token: 'secret' }, { auth: { user: 'me', pass: 'secret' }, 'not a name': 1 }, undefined);

    expect(names).toEqual(['base_url', 'token', 'auth', 'auth.user', 'auth.pass']);
    expect(requestPrompt('get pets', names)[0].content).toContain('base_url, token, auth, auth.user, auth.pass');
    expect(JSON.stringify(requestPrompt('get pets', names))).not.toContain('secret');
  });
});

describe('parseRequestReply()', () => {
  it('reads the request out of a fenced reply', () => {
    const reply = 'Here you go:\n```json\n{"name": "Create order", "method": "post", "url": "{{ base_url }}/orders", "headers": [{"name": "Content-Type", "value": "application/json"}, {"name": ""}], "body": {"mimeType": "application/json", "text": "{\\"sku\\": \\"A-1\\"}"}}\n```';

    expect(parseRequestReply(reply)).toEqual({
      name: 'Create order',
      method: 'POST',
      url: '{{ base_url }}/orders',
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: { mimeType: 'application/json', text: '{"sku": "A-1"}' },
    });
  });

  it('fills in what a reply leaves out, and refuses one without a URL', () => {
    expect(parseRequestReply('{"url": "https://api.example.com/pets", "method": "not a method"}')).toEqual({ method: 'GET', url: 'https://api.example.com/pets', headers: [] });
    expect(() => parseRequestReply('Sorry, I can\'t help with that.')).toThrow("The model's reply wasn't a request");
    expect(() => parseRequestReply('{"method": "GET"}')).toThrow("wasn't a request");
  });
});

describe('commit messages', () => {
  const changes = [
    { status: 'modified', type: 'Request', name: 'Create order', diff: { noise: false, changes: [{ field: 'url', before: 'https://a/secret-token', after: 'https://b' }, { field: 'headers', detail: 'added X-Trace' }] } },
    { status: '*added', type: 'Request', name: 'Refund' },
    { status: 'deleted', type: 'Environment', name: 'Old' },
  ];

  it('describes each change by name and fields, without their values', () => {
    expect(commitChangesSummary(changes)).toBe([
      '- modified Request "Create order": url, headers (added X-Trace)',
      '- added Request "Refund"',
      '- deleted Environment "Old"',
    ].join('\n'));
    expect(JSON.stringify(commitPrompt(changes))).not.toContain('secret-token');
  });

  it('cleans up a reply', () => {
    expect(cleanCommitMessage('```\nAdd refunds\n\n- add Refund request\n```')).toBe('Add refunds\n\n- add Refund request');
    expect(cleanCommitMessage(' "Add refunds" ')).toBe('Add refunds');
  });
});
