import { describe, expect, it } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { INSTRUCTIONS_URI, registerInstructions } from '../../instructions';
import { filterTools, MINIMAL_TOOLS, registerTools } from '../index';

describe('the minimal tool set', () => {
  it('names only tools there are', () => {
    const names = new Set<string>();
    registerTools({ tool: (name: string) => names.add(name) } as any);
    expect([...MINIMAL_TOOLS].filter(name => !names.has(name))).toEqual([]);
    expect(MINIMAL_TOOLS.size).toBeLessThan(names.size / 3);
  });

  it('offers only those tools, and keeps the instructions resource', () => {
    const server = new McpServer({ name: 'test', version: '1' });
    const minimal = filterTools(server, name => MINIMAL_TOOLS.has(name));
    registerInstructions(minimal);
    registerTools(minimal);
    // the SDK keeps what was registered on the real server
    const tools = Object.keys((server as any)._registeredTools).sort();
    expect(tools).toEqual([...MINIMAL_TOOLS].sort());
    expect(Object.keys((server as any)._registeredResources)).toEqual([INSTRUCTIONS_URI]);
  });

  it('passes a tool through with its schema and handler', () => {
    const server = new McpServer({ name: 'test', version: '1' });
    const filtered = filterTools(server, name => name === 'kept');
    filtered.tool('kept', 'kept', { a: z.string() }, async () => ({ content: [] }));
    filtered.tool('dropped', 'dropped', {}, async () => ({ content: [] }));
    expect(Object.keys((server as any)._registeredTools)).toEqual(['kept']);
    expect((server as any)._registeredTools.kept.description).toBe('kept');
  });
});
