/**
 * @jest-environment node
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

const file = { clear: jest.fn() };
const transport = { getFile: () => file, archiveLog: jest.fn(), maxSize: 0, sync: true, level: 'info' as string | false };
jest.mock('electron-log', () => ({ __esModule: true, default: { transports: { file: transport }, functions: {} } }));
jest.mock('../constants', () => ({ isDevelopment: () => false }));

const type = process.type;
const as = (processType: string) => Object.defineProperty(process, 'type', { value: processType, configurable: true });

describe('initializeLogging()', () => {
  afterEach(() => {
    as(type);
    transport.sync = true;
  });

  it('starts the log afresh in the main process, writing as each line comes', () => {
    as('browser');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../log').initializeLogging();

    expect(transport.archiveLog).toHaveBeenCalledWith(file);
    expect(file.clear).toHaveBeenCalled();
    expect(transport.sync).toBe(true);
  });

  it("in a window, keeps what's in it and writes when idle", () => {
    as('renderer');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../log').initializeLogging();

    expect(transport.archiveLog).not.toHaveBeenCalled();
    expect(file.clear).not.toHaveBeenCalled();
    expect(transport.sync).toBe(false);
  });
});
