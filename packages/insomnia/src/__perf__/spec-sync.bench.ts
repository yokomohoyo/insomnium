// npm run bench -- spec-sync
import { describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../__jest__/before-each';
import { database } from '../common/database';
import { ResourceCache, scanResources } from '../common/import';
import { syncSpecToWorkspace } from '../common/spec-sync';
import * as models from '../models';
import { largeOpenApi } from './fixtures';
import { report } from './seed';

// more ids than the mocked list has
// eslint-disable-next-line @typescript-eslint/no-var-requires
jest.mock('uuid', () => ({ v4: () => require('crypto').randomUUID() }));

describe('generating requests from a spec (the Spec tab, and over MCP)', () => {
  for (const paths of [500, 2000]) {
    it(`${paths} paths`, async () => {
      await globalBeforeEach();
      const workspace = await models.workspace.create({ name: 'Design', scope: 'design' });
      await scanResources({ content: largeOpenApi(paths, 'yaml') });
      const resources = ResourceCache!.resources;
      const writes = jest.spyOn(database, 'insert');

      let start = performance.now();
      const first = await syncSpecToWorkspace({ workspaceId: workspace._id, resources });
      report(`first generation, ${paths} paths (${first.added.length} requests, ${writes.mock.calls.length} inserts)`, performance.now() - start);
      start = performance.now();
      const again = await syncSpecToWorkspace({ workspaceId: workspace._id, resources });
      report(`again, nothing changed, ${paths} paths`, performance.now() - start);
      expect(again.unchanged.length).toBe(first.added.length);
      writes.mockRestore();
    }, 300_000);
  }
});
