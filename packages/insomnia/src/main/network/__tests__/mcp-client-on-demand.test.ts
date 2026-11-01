/**
 * @jest-environment node
 */
import { describe, expect, it, jest } from '@jest/globals';

// whether the MCP SDK's client has been loaded
let mockSdkLoaded = false;
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  mockSdkLoaded = true;
  return { Client: class {
    connect = async () => {};
    getServerCapabilities = () => ({});
    getServerVersion = () => ({ name: 'stub', version: '1' });
    getInstructions = () => undefined;
    close = async () => {};
  } };
});
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: class {} }));
jest.mock('electron', () => ({
  ...(jest.requireActual('electron') as object),
  ipcMain: { on: () => {}, once: () => {}, handle: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}));

describe('the MCP client', () => {
  it('loads the SDK when a request first connects, not as the app starts', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const client = require('../mcp-client');
    client.registerMcpClientHandlers();
    expect(mockSdkLoaded).toBe(false);

    expect(await client.mcpConnect({ requestId: 'req_1', transport: 'stdio', command: 'server' })).toMatchObject({ name: 'stub', transport: 'stdio' });
    expect(mockSdkLoaded).toBe(true);
    await client.mcpDisconnect({ requestId: 'req_1' });
  });
});
