import { describe, expect, it } from '@jest/globals';

import { mcpServerAction } from '../server-state';

const token = 'a'.repeat(32);
const on = { mcpEnabled: true, mcpPort: 0, mcpToken: token };

describe('mcpServerAction()', () => {
  it('starts and stops with the setting', () => {
    expect(mcpServerAction(on, null)).toBe('start');
    expect(mcpServerAction({ ...on, mcpEnabled: false }, { port: 4000, token })).toBe('stop');
    expect(mcpServerAction({ ...on, mcpEnabled: false }, null)).toBe('none');
    expect(mcpServerAction(on, { port: 4000, token })).toBe('none');
  });

  it('starts again on a new port', () => {
    expect(mcpServerAction({ ...on, mcpPort: 5000 }, { port: 4000, token })).toBe('restart');
    expect(mcpServerAction({ ...on, mcpPort: 4000 }, { port: 4000, token })).toBe('none');
  });

  it('starts again on a regenerated token, so the old one stops working', () => {
    expect(mcpServerAction({ ...on, mcpToken: 'b'.repeat(32) }, { port: 4000, token })).toBe('restart');
    // one the server makes as it starts
    expect(mcpServerAction({ ...on, mcpToken: '' }, { port: 4000, token })).toBe('none');
  });
});
