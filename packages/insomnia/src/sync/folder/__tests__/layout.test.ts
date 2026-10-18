import { describe, expect, it } from '@jest/globals';
import Ajv from 'ajv';
import YAML from 'yaml';

import { collectionFiles, folderDocs, type SyncDoc } from '../layout';
import { folderSchema } from '../schema';

const docs: SyncDoc[] = [
  { _id: 'wrk_1', type: 'Workspace', parentId: 'proj_1', name: 'Shop', description: 'The shop', scope: 'collection', modified: 5, created: 1 },
  { _id: 'env_1', type: 'Environment', parentId: 'wrk_1', name: 'Base Environment', data: { base_url: 'https://shop.example.com' }, metaSortKey: 0 },
  { _id: 'env_2', type: 'Environment', parentId: 'env_1', name: 'Staging', data: { base_url: 'https://staging.example.com' }, metaSortKey: 1 },
  { _id: 'env_3', type: 'Environment', parentId: 'env_1', name: 'Mine', data: { token: 'secret' }, isPrivate: true, metaSortKey: 2 },
  { _id: 'fld_1', type: 'RequestGroup', parentId: 'wrk_1', name: 'Orders', metaSortKey: 1 },
  { _id: 'req_1', type: 'Request', parentId: 'fld_1', name: 'Create order', method: 'POST', url: '{{ base_url }}/orders', metaSortKey: 2, modified: 9 },
  { _id: 'req_2', type: 'Request', parentId: 'fld_1', name: 'Create order', method: 'PUT', url: '{{ base_url }}/orders/1', metaSortKey: 3 },
  { _id: 'ex_1', type: 'ResponseExample', parentId: 'req_1', name: 'Created', statusCode: 201, body: '{}', metaSortKey: 1 },
  { _id: 'ws-req_1', type: 'WebSocketRequest', parentId: 'wrk_1', name: 'live/feed', url: 'wss://shop.example.com', metaSortKey: 2 },
];

describe('collectionFiles()', () => {
  it('lays a collection out as readable files, by folder and name', () => {
    const files = collectionFiles(docs);

    expect([...files.keys()].sort()).toEqual([
      'Orders/Create order (2).yaml',
      'Orders/Create order.yaml',
      'Orders/_folder.yaml',
      'environments/Staging.yaml',
      'environments/_base.yaml',
      'insomnium.yaml',
      'live-feed.yaml',
    ]);
    const request = YAML.parse(files.get('Orders/Create order.yaml')!);
    expect(request).toEqual({
      _id: 'req_1', type: 'Request', name: 'Create order', method: 'POST', url: '{{ base_url }}/orders', order: 2,
      examples: [{ _id: 'ex_1', type: 'ResponseExample', name: 'Created', body: '{}', statusCode: 201, order: 1 }],
    });
    // no timestamps, and the first lines say what it is
    expect(files.get('insomnium.yaml')).not.toContain('modified');
    expect(files.get('Orders/Create order.yaml')!.split('\n').slice(0, 4)).toEqual(['# yaml-language-server: $schema=../.insomnium/folder.schema.json', '_id: req_1', 'type: Request', 'name: Create order']);
    expect(JSON.stringify([...files.values()])).not.toContain('secret');
  });

  it("keeps clear of names Windows keeps, and of other files", () => {
    const files = collectionFiles([docs[0], { _id: 'req_c', type: 'Request', parentId: 'wrk_1', name: 'CON' }, { _id: 'fld_a', type: 'RequestGroup', parentId: 'wrk_1', name: 'aux.v2' }, { _id: 'req_r', type: 'Request', parentId: 'wrk_1', name: 'Readme' }], new Set(['readme.yaml']));

    expect([...files.keys()].sort()).toEqual(['Readme (2).yaml', 'aux.v2_/_folder.yaml', 'CON_.yaml', 'insomnium.yaml'].sort());
  });

  it('keeps a long value on one line', () => {
    const description = 'Lists the orders placed in the last thirty days, newest first, with their items and totals';
    const files = collectionFiles([docs[0], { _id: 'req_9', type: 'Request', parentId: 'wrk_1', name: 'Long', description }]);

    expect(files.get('Long.yaml')).toContain(`description: ${description}\n`);
    // and other YAML is written as before
    expect(YAML.stringify({ description })).not.toContain(`description: ${description}\n`);
  });
});

describe('the folder schema', () => {
  it('takes every file a collection is written as, and each names it', () => {
    const validate = new Ajv({ strict: false }).compile(folderSchema);
    for (const [path, content] of collectionFiles(docs)) {
      expect(content.split('\n')[0]).toBe(`# yaml-language-server: $schema=${'../'.repeat(path.split('/').length - 1)}.insomnium/folder.schema.json`);
      expect({ path, valid: validate(YAML.parse(content)), errors: validate.errors }).toEqual({ path, valid: true, errors: null });
    }
  });

  it('catches a mistake in a file written by hand', () => {
    const validate = new Ajv({ strict: false }).compile(folderSchema);
    expect(validate({ type: 'Request', headers: [{ value: 'no name' }] })).toBe(false);
    expect(validate({ type: 'Reqeust' })).toBe(false);
    expect(validate({ name: 'no type' })).toBe(false);
    expect(validate({ type: 'Environment', data: { base_url: 'https://api.example.com' } })).toBe(true);
  });
});

describe('folderDocs()', () => {
  it('reads the files back as the same documents, with where they sit as their parent', () => {
    const { docs: read, problems } = folderDocs(collectionFiles(docs), () => 'new');

    expect(problems).toEqual([]);
    const byId = new Map(read.map(doc => [doc._id, doc]));
    expect(byId.get('req_1')).toMatchObject({ type: 'Request', parentId: 'fld_1', method: 'POST', metaSortKey: 2 });
    expect(byId.get('ex_1')).toMatchObject({ type: 'ResponseExample', parentId: 'req_1', statusCode: 201 });
    expect(byId.get('env_2')).toMatchObject({ parentId: 'env_1', data: { base_url: 'https://staging.example.com' } });
    expect(byId.get('ws-req_1')).toMatchObject({ type: 'WebSocketRequest', parentId: 'wrk_1' });
    expect(byId.get('wrk_1')).toMatchObject({ name: 'Shop' });
    expect(byId.has('env_3')).toBe(false);
  });

  it('takes a file moved to another folder as moved, and a new one as new', () => {
    const files = collectionFiles(docs);
    files.set('Moved/_folder.yaml', 'type: RequestGroup\nname: Moved\n');
    files.set('Moved/Create order.yaml', files.get('Orders/Create order.yaml')!);
    files.delete('Orders/Create order.yaml');
    files.set('Orders/Refund.yaml', 'type: Request\nname: Refund\nmethod: POST\nurl: "{{ base_url }}/refunds"\n');

    const { docs: read } = folderDocs(files, type => `${type}-new`);

    const moved = read.find(doc => doc._id === 'req_1')!;
    const folder = read.find(doc => doc.name === 'Moved')!;
    expect(folder._id).toBe('RequestGroup-new');
    expect(moved.parentId).toBe(folder._id);
    expect(read.find(doc => doc.name === 'Refund')).toMatchObject({ _id: 'Request-new', type: 'Request', parentId: 'fld_1', method: 'POST' });
  });

  it("leaves other YAML alone, and says what it couldn't read", () => {
    const files = collectionFiles(docs);
    files.set('docker-compose.yaml', 'services:\n  web:\n    image: nginx\n');
    files.set('ci/_folder.yaml', 'jobs: {}\n');
    files.set('ci/build.yaml', 'type: Request\nname: lost\n');
    files.set('Orders/broken.yaml', 'type: [Request\n');

    const { docs: read, problems } = folderDocs(files, () => 'new');

    expect(read.map(doc => doc.name)).not.toContain('lost');
    expect(read).toHaveLength(8);
    expect(problems).toEqual([expect.stringContaining('Orders/broken.yaml')]);
    expect(folderDocs(new Map([['a.yaml', 'type: Request']]), () => 'x').problems).toEqual([expect.stringContaining('insomnium.yaml')]);
  });
});
