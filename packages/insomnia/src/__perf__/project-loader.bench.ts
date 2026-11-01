// npm run bench -- project-loader
import { describe, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../__jest__/before-each';
import { database } from '../common/database';
import * as models from '../models';
import { loader } from '../ui/routes/project';
import { largeOpenApi } from './fixtures';
import { median, report } from './seed';

// more ids than the mocked list has
// eslint-disable-next-line @typescript-eslint/no-var-requires
jest.mock('uuid', () => ({ v4: () => require('crypto').randomUUID() }));

describe('projects page loader (on every revalidation of the home page)', () => {
  for (const workspaces of [50, 300]) {
    it(`${workspaces} workspaces`, async () => {
      await globalBeforeEach();
      const project = await models.project.create({ name: 'Perf' });
      const spec = largeOpenApi(200, 'yaml');
      for (let i = 0; i < workspaces; i++) {
        const workspace = await models.workspace.create({ parentId: project._id, name: `W ${i}`, scope: i % 3 ? 'collection' : 'design' });
        if (i % 3 === 0) {
          await models.apiSpec.updateOrCreateForParentId(workspace._id, { contents: spec });
        }
      }
      const args = { request: { url: 'http://localhost/' }, params: { organizationId: 'org', projectId: project._id } } as any;
      // (the first load makes the workspaces' metas)
      await loader(args);
      const finds = jest.spyOn(database, 'find');
      await loader(args);
      console.log(`  ${finds.mock.calls.length} queries per load, ${workspaces} workspaces`);
      finds.mockRestore();
      report(`projects loader, ${workspaces} workspaces`, await median(() => loader(args)));
    }, 300_000);
  }
});
