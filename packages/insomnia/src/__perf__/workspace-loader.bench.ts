// npm run bench -- workspace-loader
import { describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../__jest__/before-each';
import * as models from '../models';
import { forgetCollectionRead, workspaceLoader } from '../ui/routes/workspace';
import { median, report, seedCollection } from './seed';

// more ids than the mocked list has
// eslint-disable-next-line @typescript-eslint/no-var-requires
jest.mock('uuid', () => ({ v4: () => require('crypto').randomUUID() }));

describe('workspace loader (the sidebar, on every revalidation)', () => {
  const runs: Record<number, number> = {};
  for (const folders of [10, 40, 100]) {
    it(`${folders * 100} requests`, async () => {
      await globalBeforeEach();
      const { project, workspace, requests } = await seedCollection({ folders, requestsPerFolder: 100 });
      const args = { request: { url: 'http://localhost/' }, params: { projectId: project._id, workspaceId: workspace._id } } as any;
      runs[requests] = await median(() => {
        forgetCollectionRead();
        return workspaceLoader(args);
      });
      report(`workspace loader, reading it all, ${requests} requests`, runs[requests]);

      // as after each save while typing in a request's URL bar
      let request = (await models.request.all())[0];
      let i = 0;
      report(`workspace loader after an edit to a request, ${requests} requests`, await median(async () => {
        request = await models.request.update(request, { url: `http://example.com/${i++}` });
        return workspaceLoader(args);
      }));
    }, 120_000);
  }

  it('grows linearly with the requests', () => {
    // 10x the requests: about 10x the time, not 100x (it was 60x before)
    expect(runs[10_000] / runs[1000]).toBeLessThan(25);
  });
});
