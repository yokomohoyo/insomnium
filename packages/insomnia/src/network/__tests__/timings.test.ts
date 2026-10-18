import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../__jest__/before-each';
import { getRenderedRequestAndContext } from '../../common/render';
import { timingPhases } from '../../common/timings';
import * as models from '../../models';
import * as networkUtils from '../network';

window.app = electron.app;

describe('response timings', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
  });

  it("keep when each part of the exchange was done, from libcurl's measures", async () => {
    const workspace = await models.workspace.create({ name: 'Timings' });
    const request = await models.request.create({ parentId: workspace._id, url: 'http://localhost/' });
    const { request: rendered } = await getRenderedRequestAndContext({ request });
    // the mock's libcurl: 10 ms to resolve, connected at 30 ms, no TLS, first byte at 500 ms
    const response = await networkUtils.sendCurlAndWriteTimeline(rendered, [], null, await models.settings.getOrCreate());
    expect(response.timings).toEqual({ dns: 10, connect: 30, tls: 0, firstByte: 500 });

    const stored = await models.response.create({ ...response, parentId: request._id });
    expect(stored.timings).toEqual({ dns: 10, connect: 30, tls: 0, firstByte: 500 });
  });

  it('split into phases, with the TLS handshake only when there was one', () => {
    expect(timingPhases({ dns: 10, connect: 30, tls: 0, firstByte: 500 }, 700)).toEqual([
      ['DNS lookup', 10],
      ['Connecting', 20],
      ['Waiting (time to first byte)', 470],
      ['Download', 200],
    ]);
    expect(timingPhases({ dns: 5, connect: 15, tls: 60, firstByte: 90 }, 100)).toEqual([
      ['DNS lookup', 5],
      ['Connecting', 10],
      ['TLS handshake', 45],
      ['Waiting (time to first byte)', 30],
      ['Download', 10],
    ]);
  });
});
