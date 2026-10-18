import { beforeEach, describe, expect, it } from '@jest/globals';
import path from 'path';
import YAML from 'yaml';

import { docDiff } from '../doc-diff';
import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR } from '../git-vcs';
import { MemClient } from '../mem-client';
import { setupDateMocks } from './util';

const request = (patch: Record<string, unknown> = {}) => YAML.stringify({
  _id: 'req_1',
  type: 'Request',
  name: 'List pets',
  method: 'GET',
  url: 'https://pets.example.com/pets',
  headers: [{ name: 'Accept', value: 'application/json' }],
  parameters: [],
  body: {},
  modified: 1,
  metaSortKey: -1,
  ...patch,
});

describe('docDiff()', () => {
  it('lists the fields that changed, from what to what', () => {
    expect(docDiff(request(), request({ method: 'POST', url: 'https://pets.example.com/animals', body: { mimeType: 'application/json', text: '{}' } }))).toEqual({
      changes: [
        { field: 'method', before: 'GET', after: 'POST' },
        { field: 'url', before: 'https://pets.example.com/pets', after: 'https://pets.example.com/animals' },
        { field: 'body', before: '{}', after: '{"mimeType":"application/json","text":"{}"}' },
      ],
      noise: false,
    });
  });

  it('says which named entries were added, removed or changed', () => {
    const { changes } = docDiff(request(), request({
      headers: [{ name: 'Accept', value: 'text/plain' }, { name: 'X-Trace', value: '1' }],
      parameters: [{ name: 'limit', value: '5' }],
    }));

    expect(changes).toEqual([
      { field: 'headers', detail: 'added X-Trace; changed Accept' },
      { field: 'parameters', detail: 'added limit' },
    ]);
    expect(docDiff(request(), request({ headers: [] })).changes).toEqual([{ field: 'headers', detail: 'removed Accept' }]);
  });

  it('counts timestamps and order as noise, not changes', () => {
    expect(docDiff(request(), request({ modified: 2, metaSortKey: -2 }))).toEqual({ changes: [], noise: true });
    expect(docDiff(request(), request())).toEqual({ changes: [], noise: false });
  });

  it('has nothing to list for a document added or deleted', () => {
    expect(docDiff(null, request())).toEqual({ changes: [], noise: false });
    expect(docDiff(request(), null)).toEqual({ changes: [], noise: false });
    expect(docDiff('not: [yaml', request())).toEqual({ changes: [], noise: false });
  });

  it('shortens long values', () => {
    const [change] = docDiff(request(), request({ description: 'x'.repeat(500) })).changes;
    expect(change.after).toHaveLength(201);
    expect(change.after?.endsWith('…')).toBe(true);
  });
});

describe('a change since the last commit', () => {
  beforeEach(setupDateMocks);

  it('compares the committed file with the working one', async () => {
    const fsClient = MemClient.createClient();
    const file = path.join(GIT_INSOMNIA_DIR, 'Request', 'req_1.yml');
    await fsClient.promises.mkdir(path.dirname(file), { recursive: true });
    await fsClient.promises.writeFile(file, request());
    await GitVCS.init({ uri: '', repoId: '', directory: GIT_CLONE_DIR, fs: fsClient });
    await GitVCS.setAuthor('Karen Brown', 'karen@example.com');
    await GitVCS.add(file);
    await GitVCS.commit('First commit!');
    await fsClient.promises.writeFile(file, request({ method: 'DELETE' }));

    const [last] = await GitVCS.log({ depth: 1 });
    const committed = await GitVCS.readObjFromTree(last.commit.tree, file);

    expect(docDiff(committed ? committed.toString() : null, await GitVCS.readWorkingFile(file)).changes).toEqual([
      { field: 'method', before: 'GET', after: 'DELETE' },
    ]);
    expect(await GitVCS.readWorkingFile(path.join(GIT_INSOMNIA_DIR, 'Request', 'gone.yml'))).toBeNull();
  });
});
