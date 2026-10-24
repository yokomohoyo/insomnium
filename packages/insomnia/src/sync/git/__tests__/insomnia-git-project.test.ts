import fs from 'fs';
import path from 'path';

import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../../__jest__/before-each';
import * as models from '../../../models';
import { findInsomniaProjectFiles, importInsomniaProjectFiles, isInsomniaV5File } from '../insomnia-git-project';
import { MemClient } from '../mem-client';

const fixtures = path.join(__dirname, '../../../utils/importers/importers/fixtures/insomnia-5');
const collection = fs.readFileSync(path.join(fixtures, 'collection-input.yaml'), 'utf8');
const spec = fs.readFileSync(path.join(fixtures, 'spec-input.yaml'), 'utf8');

// a cloned repository, as the clone dialog has it
const repository = async (files: Record<string, string>) => {
  const fsClient = MemClient.createClient();
  for (const [file, content] of Object.entries(files)) {
    await fsClient.promises.mkdir(path.dirname(file), { recursive: true });
    await fsClient.promises.writeFile(file, content);
  }
  return fsClient;
};

describe('a Git project of Insomnia', () => {
  beforeEach(globalBeforeEach);

  it('is told by its files: v5 collections and documents', () => {
    expect(isInsomniaV5File(collection)).toBe(true);
    expect(isInsomniaV5File(spec)).toBe(true);
    expect(isInsomniaV5File('type: environment.insomnia.rest/5.0\nname: Globals')).toBe(false);
    expect(isInsomniaV5File('openapi: 3.0.3\n# type: collection.insomnia.rest/5.0')).toBe(false);
  });

  it("has its files found anywhere but in dot folders and node_modules, and not past the limits", async () => {
    const fsClient = await repository({
      'store.yaml': collection,
      'apis/petstore/spec.yml': spec,
      'README.md': 'type: collection.insomnia.rest/5.0',
      'ci.yaml': 'on: push',
      '.github/insomnia.yaml': collection,
      'node_modules/pkg/collection.yaml': collection,
    });
    expect((await findInsomniaProjectFiles(fsClient)).map(file => file.path)).toEqual(['apis/petstore/spec.yml', 'store.yaml']);
    expect(await findInsomniaProjectFiles(fsClient, { maxDepth: 1 })).toHaveLength(1);
    expect(await findInsomniaProjectFiles(fsClient, { maxFiles: 1 })).toHaveLength(1);
    expect(await findInsomniaProjectFiles(fsClient, { maxBytes: 10 })).toHaveLength(0);
  });

  it('imports each file as a collection or document of its own, and says which failed', async () => {
    const project = await models.project.create({ name: 'Cloned' });
    const { workspaces, failed } = await importInsomniaProjectFiles([
      { path: 'store.yaml', content: collection },
      { path: 'spec.yaml', content: spec },
      { path: 'broken.yaml', content: 'type: collection.insomnia.rest/5.0\ncollection: [' },
    ], project._id);

    expect(workspaces.map(({ name, scope }) => ({ name, scope })).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      expect.objectContaining({ scope: 'design' }),
      { name: 'Store API', scope: 'collection' },
    ]);
    expect(await models.request.findByParentId((await models.requestGroup.findByParentId(workspaces.find(({ name }) => name === 'Store API')!._id))[0]._id)).not.toHaveLength(0);
    expect(failed.map(file => file.path)).toEqual(['broken.yaml']);
  });
});
