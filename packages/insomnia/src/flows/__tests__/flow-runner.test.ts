import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { appFlowRunner } from '../flow-runner';

jest.mock('../../network/runner', () => ({ sendForRun: jest.fn() }));
jest.mock('../../network/network', () => ({ cancelCurlAndWriteTimeline: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendForRun } = require('../../network/runner');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { cancelCurlAndWriteTimeline } = require('../../network/network');

describe('appFlowRunner', () => {
  beforeEach(globalBeforeEach);

  it("cancels the send in flight when the flow is stopped, wherever it runs (MCP's runs are in the main process)", async () => {
    const workspace = await models.workspace.create({ name: 'Pets' });
    const request = await models.request.create({ parentId: workspace._id, url: 'http://127.0.0.1/slow' });
    // the send ends once it's cancelled, as curl's does
    let finish = () => {};
    sendForRun.mockImplementation(() => new Promise(resolve => {
      finish = () => resolve({ stored: { error: 'Request was cancelled' }, url: request.url });
    }));
    cancelCurlAndWriteTimeline.mockImplementation(async () => finish());

    const stop = new AbortController();
    const sent = appFlowRunner({ workspaceId: workspace._id }).send(request._id, {}, stop.signal);
    await new Promise(resolve => setTimeout(resolve, 10));
    stop.abort();

    await expect(sent).rejects.toThrow('Stopped');
    expect(cancelCurlAndWriteTimeline).toHaveBeenCalledWith(request._id);
  });
});
