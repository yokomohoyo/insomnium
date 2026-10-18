import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import path from 'path';
import YAML from 'yaml';

import GitVCS, { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GitConflictsError } from '../git-vcs';
import { MemClient } from '../mem-client';
import { describeDoc, isSyncedDoc, mergeDoc } from '../merge-docs';
import { setupDateMocks } from './util';

const doc = (patch: Record<string, unknown> = {}) => YAML.stringify({
  _id: 'req_1',
  type: 'Request',
  name: 'List pets',
  method: 'GET',
  url: 'https://pets.example.com/pets',
  headers: [{ name: 'Accept', value: 'application/json' }],
  modified: 1,
  metaSortKey: -1,
  ...patch,
});
const parsed = (text?: string) => text === undefined ? undefined : YAML.parse(text);

describe('mergeDoc()', () => {
  it('applies both sides when they changed different fields', () => {
    const { merged, conflicts } = mergeDoc(doc(), doc({ method: 'POST', modified: 2 }), doc({ url: 'https://pets.example.com/animals', modified: 3 }));

    expect(conflicts).toEqual([]);
    expect(parsed(merged)).toMatchObject({ method: 'POST', url: 'https://pets.example.com/animals', modified: 3 });
  });

  it("takes a side's change, a field either side removed, and a change both made alike", () => {
    // ours removed the description, theirs left it; both renamed it alike
    const { merged } = mergeDoc(doc({ description: 'old' }), doc({ name: 'All pets' }), doc({ description: 'old', name: 'All pets' }));

    expect(parsed(merged)).toMatchObject({ name: 'All pets' });
    expect(parsed(merged)).not.toHaveProperty('description');
  });

  it('reports the fields both sides changed differently, without a choice', () => {
    expect(mergeDoc(doc(), doc({ url: 'https://a.example.com', method: 'PUT' }), doc({ url: 'https://b.example.com', method: 'PUT' }))).toEqual({
      conflicts: [{ field: 'url', ours: 'https://a.example.com', theirs: 'https://b.example.com' }],
    });
  });

  it('decides those fields by the choice, and still merges the rest', () => {
    const ours = doc({ url: 'https://a.example.com', method: 'POST' });
    const theirs = doc({ url: 'https://b.example.com', headers: [] });

    expect(parsed(mergeDoc(doc(), ours, theirs, 'ours').merged)).toMatchObject({ url: 'https://a.example.com', method: 'POST', headers: [] });
    expect(parsed(mergeDoc(doc(), ours, theirs, 'theirs').merged)).toMatchObject({ url: 'https://b.example.com', method: 'POST', headers: [] });
  });

  it('settles timestamps and order without asking', () => {
    const { merged, conflicts } = mergeDoc(doc(), doc({ modified: 5, metaSortKey: -5 }), doc({ modified: 9, metaSortKey: -9 }));

    expect(conflicts).toEqual([]);
    expect(parsed(merged)).toMatchObject({ modified: 9, metaSortKey: -5 });
  });

  it('takes a whole file that is not a document only by choice', () => {
    expect(mergeDoc('a', 'b: [', 'c')).toEqual({ conflicts: [{ field: '(file)' }] });
    expect(mergeDoc('a', 'b: [', 'c', 'theirs')).toEqual({ merged: 'c', conflicts: [] });
  });

  it('merges a long text both sides changed in different places, line by line', () => {
    const body = (first: string, last: string) => doc({ body: { mimeType: 'application/json', text: `{\n  "name": "${first}",\n  "kind": "dog",\n  "age": ${last}\n}` } });
    const { merged } = mergeDoc(body('Rex', '3'), body('Fido', '3'), body('Rex', '4'));

    expect(parsed(merged).body.text).toBe('{\n  "name": "Fido",\n  "kind": "dog",\n  "age": 4\n}');
  });

  it('knows a synced document by its name and _id', () => {
    expect(isSyncedDoc('req_1.yml', doc())).toBe(true);
    expect(isSyncedDoc('package.json', '{"name": "app"}')).toBe(false);
    expect(isSyncedDoc('other.yml', doc())).toBe(false);
  });

  it('names a document for the list', () => {
    expect(describeDoc('x: [', doc())).toEqual({ name: 'List pets', type: 'Request' });
  });
});

describe('GitVCS.mergeByField()', () => {
  const file = path.join(GIT_INSOMNIA_DIR, 'Request', 'req_1.yml');
  let fsClient: ReturnType<typeof MemClient.createClient>;
  const commit = async (text: string, message: string) => {
    await fsClient.promises.writeFile(file, text);
    await GitVCS.add(file);
    await GitVCS.commit(message);
  };
  const working = async () => YAML.parse((await fsClient.promises.readFile(file)).toString());

  afterAll(() => jest.restoreAllMocks());
  beforeEach(async () => {
    setupDateMocks();
    fsClient = MemClient.createClient();
    await fsClient.promises.mkdir(path.dirname(file), { recursive: true });
    await GitVCS.init({ uri: '', repoId: '', directory: GIT_CLONE_DIR, fs: fsClient });
    await GitVCS.setAuthor('Karen Brown', 'karen@example.com');
    await commit(doc(), 'first');
    await GitVCS.branch('theirs', true);
  });

  it("merges a branch's change to another field, and stays on this branch", async () => {
    await commit(doc({ url: 'https://pets.example.com/animals' }), 'their url');
    await GitVCS.checkout('main');
    await commit(doc({ method: 'POST' }), 'our method');

    await GitVCS.mergeByField('theirs');

    expect(await GitVCS.getBranch()).toBe('main');
    expect(await working()).toMatchObject({ method: 'POST', url: 'https://pets.example.com/animals' });
  });

  it("merges the repository's other files by line, as they are", async () => {
    const pkg = path.join(GIT_CLONE_DIR, 'package.json');
    const write = async (text: string, message: string) => {
      await fsClient.promises.writeFile(pkg, text);
      await GitVCS.add(pkg);
      await GitVCS.commit(message);
    };
    await GitVCS.checkout('main');
    await write('{\n  "name": "app",\n  "version": "1.0.0",\n  "private": true\n}\n', 'package');
    await GitVCS.checkout('theirs');
    await write('{\n  "name": "app",\n  "version": "1.0.0",\n  "private": true\n}\n', 'package');
    await commit(doc({ url: 'https://pets.example.com/animals' }), 'their url');
    await write('{\n  "name": "app",\n  "version": "1.1.0",\n  "private": true\n}\n', 'their version');
    await GitVCS.checkout('main');
    await write('{\n  "name": "app-renamed",\n  "version": "1.0.0",\n  "private": true\n}\n', 'our name');
    await commit(doc({ method: 'POST' }), 'our method');

    await GitVCS.mergeByField('theirs');

    expect((await fsClient.promises.readFile(pkg)).toString()).toBe('{\n  "name": "app-renamed",\n  "version": "1.1.0",\n  "private": true\n}\n');
    expect(await working()).toMatchObject({ method: 'POST', url: 'https://pets.example.com/animals' });
  });

  it('lists a clash, then merges it as chosen', async () => {
    await commit(doc({ url: 'https://b.example.com' }), 'their url');
    await GitVCS.checkout('main');
    await commit(doc({ url: 'https://a.example.com' }), 'our url');

    const clash = await GitVCS.mergeByField('theirs').catch(err => err);
    expect(clash).toBeInstanceOf(GitConflictsError);
    expect(clash.conflicts).toEqual([{
      file: 'req_1.yml',
      name: 'List pets',
      type: 'Request',
      fields: [{ field: 'url', ours: 'https://a.example.com', theirs: 'https://b.example.com' }],
    }]);
    expect(await working()).toMatchObject({ url: 'https://a.example.com' });

    await GitVCS.mergeByField('theirs', { 'req_1.yml': 'theirs' });

    expect(await working()).toMatchObject({ url: 'https://b.example.com' });
    const [merge] = await GitVCS.log({ depth: 1 });
    expect(merge.commit.parent).toHaveLength(2);
  });
});
