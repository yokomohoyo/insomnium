import { describe, expect, it } from '@jest/globals';

import { mcpErrorMessage } from '../mcp-connection';

describe('mcpErrorMessage()', () => {
  it("leaves out Electron's wrapping of an error from the main process", () => {
    const wrapped = new Error("Error invoking remote method 'mcpClient:connect': Error: Enter the MCP server's http:// or https:// URL, not \"\"");
    expect(mcpErrorMessage(wrapped)).toBe("Enter the MCP server's http:// or https:// URL, not \"\"");
  });

  it('keeps any other message as it is', () => {
    expect(mcpErrorMessage(new Error('The server closed the connection'))).toBe('The server closed the connection');
    expect(mcpErrorMessage('timed out')).toBe('timed out');
  });
});
