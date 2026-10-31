import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react';
import React from 'react';

import type { Request } from '../../../../models/request';
import { RequestRow } from '../request-row';

// the row's button, in a document of its own
const row = (request: Partial<Request> & Pick<Request, 'type'>) => render(
  <ul><RequestRow handleSetItemSelected={jest.fn()} isSelected request={{ _id: 'req_1', name: 'Pets', method: 'GET', headers: [], body: {}, ...request } as Request} /></ul>,
).container.querySelector('button') as HTMLButtonElement;

describe('<RequestRow />', () => {
  it('labels a request as the request tabs do, on the same line as its name', () => {
    const button = row({ type: 'Request', headers: [{ name: 'Accept', value: 'text/event-stream' }] });
    expect(button.className).toContain('flex');
    expect(button.textContent).toBe('SSEPets');
  });

  it('labels the other kinds', () => {
    expect(row({ type: 'GrpcRequest' }).textContent).toBe('gRPCPets');
    expect(row({ type: 'WebSocketRequest' }).textContent).toBe('WSPets');
    expect(row({ type: 'McpRequest' }).textContent).toBe('MCPPets');
    expect(row({ type: 'Request', method: 'DELETE' }).textContent).toBe('DELPets');
  });
});
