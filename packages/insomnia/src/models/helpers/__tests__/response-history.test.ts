import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../index';
import * as requestOperations from '../request-operations';

// The HTTP and WebSocket response models share their history handling
// (helpers/response-history); these run against each model's own exports.
const cases = [
  {
    label: 'response',
    model: models.response,
    pathField: 'bodyPath',
    createRequest: () => models.request.create({ parentId: 'wrk_1', name: 'r' }),
  },
  {
    label: 'webSocketResponse',
    model: models.webSocketResponse,
    pathField: 'eventLogPath',
    createRequest: () => models.webSocketRequest.create({ parentId: 'wrk_1', name: 'r' }),
  },
] as const;

describe.each(cases)('$label history', ({ label, model, pathField, createRequest }) => {
  beforeEach(globalBeforeEach);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // `modified` is given so the order doesn't depend on the clock
  const create = (parentId: string, n: number, environmentId?: string | null, max?: number) => model.create({
    parentId,
    statusCode: n,
    modified: n,
    ...(environmentId === undefined ? {} : { environmentId }),
  }, max);

  const statusCodes = async (parentId: string) => (
    (await model.findByParentId(parentId)).map(r => r.statusCode).sort((a, b) => a - b)
  );

  describe('create()', () => {
    it('throws without a parentId', async () => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      await expect(model.create({ statusCode: 1 })).rejects.toThrow('New Response missing `parentId`');
      // only the HTTP model logs the patch first
      const logged = log.mock.calls.filter(([message]) => message === '[db] Attempted to create response without `parentId`');
      expect(logged).toEqual(label === 'response' ? [[expect.any(String), { statusCode: 1 }]] : []);
    });

    it('sets requestVersionId to null when the request does not exist', async () => {
      const response = await create('req_missing', 1);
      expect(response.type).toBe(model.type);
      expect(response.requestVersionId).toBeNull();
    });

    it('snapshots the request and removes versions no response refers to', async () => {
      const request = await createRequest();
      const first = await create(request._id, 1, undefined, 1);
      expect(first.requestVersionId).toEqual(expect.any(String));
      await requestOperations.update(request, { url: 'https://changed.example' });
      const second = await create(request._id, 2, undefined, 1);
      expect(second.requestVersionId).not.toBe(first.requestVersionId);

      await create(request._id, 3, undefined, 1);
      // 1 was pruned, so its version went too
      expect(await statusCodes(request._id)).toEqual([2, 3]);
      expect(await models.requestVersion.getById(first.requestVersionId as string)).toBeNull();
      expect(await models.requestVersion.getById(second.requestVersionId as string)).not.toBeNull();
    });

    it('keeps the most recent maxResponses earlier responses', async () => {
      for (let n = 1; n <= 5; n++) {
        await create('req_1', n, undefined, 100);
      }
      await create('req_other', 50, undefined, 100);

      await create('req_1', 6, undefined, 2);
      expect(await statusCodes('req_1')).toEqual([4, 5, 6]);
      expect(await statusCodes('req_other')).toEqual([50]);
    });

    it('keeps at least one earlier response', async () => {
      await create('req_1', 1);
      await create('req_1', 2);
      await create('req_1', 3, undefined, 0);
      expect(await statusCodes('req_1')).toEqual([2, 3]);
    });

    it('defaults to keeping 20', async () => {
      for (let n = 1; n <= 23; n++) {
        await create('req_1', n);
      }
      expect((await statusCodes('req_1'))[0]).toBe(3);
    });

    it('prunes per environment when filtering by environment', async () => {
      await models.settings.patch({ filterResponsesByEnv: true });
      await create('req_1', 1, 'env_a', 100);
      await create('req_1', 2, 'env_a', 100);
      await create('req_1', 3, 'env_b', 100);
      await create('req_1', 4, null, 100);

      await create('req_1', 5, 'env_a', 1);
      expect(await statusCodes('req_1')).toEqual([2, 3, 4, 5]);

      // without an environmentId in the patch, across all environments
      await create('req_1', 6, undefined, 1);
      expect(await statusCodes('req_1')).toEqual([5, 6]);
    });

    it('prunes across environments when not filtering', async () => {
      await create('req_1', 1, 'env_a', 100);
      await create('req_1', 2, 'env_b', 100);
      await create('req_1', 3, 'env_a', 1);
      expect(await statusCodes('req_1')).toEqual([2, 3]);
    });
  });

  describe('getLatestForRequest()', () => {
    it('returns null when there is none', async () => {
      expect(await model.getLatestForRequest('req_1', null)).toBeNull();
    });

    it('ignores the environment when not filtering', async () => {
      await create('req_1', 1, 'env_a');
      await create('req_1', 2, 'env_b');
      await create('req_2', 3, 'env_a');
      expect((await model.getLatestForRequest('req_1', 'env_a'))?.statusCode).toBe(2);
    });

    it('returns the latest of the environment when filtering', async () => {
      await models.settings.patch({ filterResponsesByEnv: true });
      await create('req_1', 1, 'env_a');
      await create('req_1', 2, 'env_a');
      await create('req_1', 3, 'env_b');
      await create('req_1', 4, null);
      expect((await model.getLatestForRequest('req_1', 'env_a'))?.statusCode).toBe(2);
      expect((await model.getLatestForRequest('req_1', null))?.statusCode).toBe(4);
      expect(await model.getLatestForRequest('req_1', 'env_c')).toBeNull();
    });
  });

  describe('removeForRequest()', () => {
    const seed = async () => {
      await create('req_1', 1, 'env_a');
      await create('req_1', 2, 'env_b');
      await create('req_1', 3, null);
      await create('req_2', 4, 'env_a');
    };

    it('removes all of the request when not filtering', async () => {
      await seed();
      await model.removeForRequest('req_1', 'env_a');
      expect(await statusCodes('req_1')).toEqual([]);
      expect(await statusCodes('req_2')).toEqual([4]);
    });

    it('removes those of the environment when filtering', async () => {
      await models.settings.patch({ filterResponsesByEnv: true });
      await seed();
      await model.removeForRequest('req_1', 'env_a');
      expect(await statusCodes('req_1')).toEqual([2, 3]);
      await model.removeForRequest('req_1', null);
      expect(await statusCodes('req_1')).toEqual([2]);
    });

    it('removes all of the request without an environment, even when filtering', async () => {
      await models.settings.patch({ filterResponsesByEnv: true });
      await seed();
      await model.removeForRequest('req_1');
      expect(await statusCodes('req_1')).toEqual([]);
      expect(await statusCodes('req_2')).toEqual([4]);
    });
  });

  describe('hookRemove()', () => {
    it('deletes the body and timeline files', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnia-history-'));
      const bodyPath = path.join(dir, 'body');
      const timelinePath = path.join(dir, 'timeline');
      fs.writeFileSync(bodyPath, 'body');
      fs.writeFileSync(timelinePath, '[]');
      const doc = await models.initModel<any>(model.type, { parentId: 'req_1', [pathField]: bodyPath, timelinePath });

      const messages: string[] = [];
      await new Promise<void>(resolve => {
        model.hookRemove(doc, (message: string) => {
          messages.push(message);
          if (messages.length === 2) {
            resolve();
          }
        });
      });

      expect(messages.sort()).toEqual([
        `[response] Delete body ${bodyPath}`,
        `[response] Delete timeline ${timelinePath}`,
      ]);
      expect(fs.existsSync(bodyPath)).toBe(false);
      expect(fs.existsSync(timelinePath)).toBe(false);
    });
  });
});
