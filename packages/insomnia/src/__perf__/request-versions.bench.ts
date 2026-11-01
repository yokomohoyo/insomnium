// npm run bench -- request-versions
import { describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../__jest__/before-each';
import { decompressObject } from '../common/misc';
import * as models from '../models';
import { median, report } from './seed';

// more ids than the mocked list has
// eslint-disable-next-line @typescript-eslint/no-var-requires
jest.mock('uuid', () => ({ v4: () => require('crypto').randomUUID() }));

describe('request versions (one per send after an edit)', () => {
  for (const sends of [100, 500]) {
    it(`${sends} edited sends`, async () => {
      await globalBeforeEach();
      const workspace = await models.workspace.create();
      let request = await models.request.create({
        parentId: workspace._id,
        method: 'POST',
        body: { mimeType: 'application/json', text: JSON.stringify({ items: Array.from({ length: 40 }, (_, i) => ({ id: i, name: `item ${i}` })) }) },
      });
      for (let i = 0; i < sends; i++) {
        request = await models.request.update(request, { url: `https://api.example.com/items?page=${i}` });
        await models.response.create({ parentId: request._id, statusCode: 200 });
      }
      const versions = await models.requestVersion.findByParentId(request._id);
      console.log(`${sends} edited sends: ${versions.length} versions kept`);

      // what the request page's loader reads on every revalidation, and the history dropdown decompresses
      report(`  the request loader's versions, ${sends} sends`, await median(() => models.requestVersion.findByParentId(request._id)));
      report(`  decompressing them all, ${sends} sends`, await median(() => versions.map(v => decompressObject(v.compressedRequest))));
      expect(versions.length).toBeLessThanOrEqual(21);
    }, 300_000);
  }
});
