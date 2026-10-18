import { beforeEach, describe, expect, it } from '@jest/globals';

import { clearConsole, consoleEntries, entryFor, MAX_CONSOLE_ENTRIES, recordSend, subscribeToConsole } from '../console-log';

describe('the console', () => {
  beforeEach(clearConsole);

  const request = { _id: 'req_1', name: 'list pets', method: 'GET', url: 'https://pets.example.com/pets' };

  it('records a send: its status, time, size, logs and assertions', () => {
    recordSend(entryFor(request, {
      statusCode: 200,
      statusMessage: 'OK',
      elapsedTime: 12.5,
      bytesRead: 2048,
      scriptLogs: [{ level: 'log', message: 'hello' }],
      assertionResults: [{ passed: true }, { passed: false }],
    }), 1000);

    expect(consoleEntries()).toEqual([{
      id: expect.any(Number), at: 1000, requestId: 'req_1', name: 'list pets', method: 'GET', url: 'https://pets.example.com/pets',
      statusCode: 200, statusMessage: 'OK', elapsedTime: 12.5, bytesRead: 2048, logs: [{ level: 'log', message: 'hello' }], passed: 1, failed: 1,
    }]);
  });

  it('records a failed send with its error', () => {
    recordSend(entryFor({ _id: 'req_2' }, { error: 'connect ECONNREFUSED' }));

    expect(consoleEntries()[0]).toMatchObject({ method: 'GET', error: 'connect ECONNREFUSED', logs: [], passed: 0, failed: 0 });
    expect(consoleEntries()[0]).not.toHaveProperty('statusCode', 0);
  });

  it('keeps the latest, and tells whoever is watching', () => {
    let changes = 0;
    const unsubscribe = subscribeToConsole(() => changes++);
    for (let index = 0; index < MAX_CONSOLE_ENTRIES + 3; index++) {
      recordSend(entryFor({ ...request, name: `send ${index}` }, { statusCode: 200 }));
    }
    unsubscribe();
    clearConsole();

    expect(changes).toBe(MAX_CONSOLE_ENTRIES + 3);
    expect(consoleEntries()).toEqual([]);
  });

  it('drops the oldest past the limit', () => {
    for (let index = 0; index < MAX_CONSOLE_ENTRIES + 3; index++) {
      recordSend(entryFor({ ...request, name: `send ${index}` }, { statusCode: 200 }));
    }
    expect(consoleEntries()).toHaveLength(MAX_CONSOLE_ENTRIES);
    expect(consoleEntries()[0].name).toBe('send 3');
  });
});
