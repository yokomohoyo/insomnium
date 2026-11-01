// npm run bench -- render
import { describe, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../__jest__/before-each';
import { RENDER_PURPOSE_SEND } from '../common/render';
import * as models from '../models';
import { tryToInterpolateRequest } from '../network/network';
import { median, report, seedCollection } from './seed';

// more ids than the mocked list has
// eslint-disable-next-line @typescript-eslint/no-var-requires
jest.mock('uuid', () => ({ v4: () => require('crypto').randomUUID() }));

describe("rendering a request to send it (each send, each runner iteration, each flow step)", () => {
  for (const envVars of [50, 500, 2000]) {
    it(`an environment of ${envVars} variables`, async () => {
      await globalBeforeEach();
      await seedCollection({ folders: 5, depth: 2, requestsPerFolder: 5, envVars });
      const request = (await models.request.all()).at(-1)!;
      report(`render, ${envVars} variables`, await median(() => tryToInterpolateRequest(request, 'env_perf_0', RENDER_PURPOSE_SEND), 9));
    }, 120_000);
  }
});
