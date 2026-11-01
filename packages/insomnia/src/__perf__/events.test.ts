import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';

import { describe, it } from '@jest/globals';

import { globalBeforeEach } from '../__jest__/before-each';
import { eventStreams } from '../main/network/curl';
import * as models from '../models';
import { median, report } from './seed';

describe('event log polling', () => {
  for (const n of [1000, 10000, 50000]) {
    it(`${n} events`, async () => {
      await globalBeforeEach();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
      const bodyPath = path.join(dir, 'log');
      const lines = [];
      for (let i = 0; i < n; i++) {
        lines.push(JSON.stringify({ _id: 'ev' + i, requestId: 'req', type: 'message', data: JSON.stringify({ i, pad: 'x'.repeat(150) }), event: 'tick', id: String(i), timestamp: Date.now() }));
      }
      fs.writeFileSync(bodyPath, lines.join('\n') + '\n');
      const workspace = await models.workspace.create();
      const request = await models.request.create({ parentId: workspace._id });
      const response = await models.response.create({ parentId: request._id, bodyPath });
      report(`findMany ${n} (${(fs.statSync(bodyPath).size / 1e6).toFixed(1)} MB)`, await median(() => eventStreams.events(response._id), 5));
      const events = await eventStreams.events(response._id);
      report(`  structured clone of the result ${n}`, await median(() => v8.deserialize(v8.serialize(events)), 5));
    }, 120000);
  }
});
