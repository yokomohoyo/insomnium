/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { FolderSync } from '../folder-sync';

describe('FolderSync', () => {
  let root: string;
  let workspaceId: string;
  let folderId: string;
  let requestId: string;
  let sync: FolderSync;
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };

  beforeEach(async () => {
    await globalBeforeEach();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-sync-'));
    workspaceId = (await models.workspace.create({ name: 'Shop', parentId: 'proj_1', scope: 'collection' }))._id;
    await models.environment.getOrCreateForParentId(workspaceId);
    folderId = (await models.requestGroup.create({ name: 'Orders', parentId: workspaceId }))._id;
    requestId = (await models.request.create({ name: 'List orders', parentId: folderId, url: 'https://shop.example.com/orders' }))._id;
    sync = new FolderSync(workspaceId, root);
    await sync.start();
    // driven by hand here, rather than by the watcher
    sync.stop();
  });
  afterEach(() => {
    sync.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes the collection out as files', () => {
    expect(read('insomnium.yaml')).toContain(`_id: ${workspaceId}`);
    expect(read('Orders/_folder.yaml')).toContain('name: Orders');
    expect(read('Orders/List orders.yaml')).toContain('url: https://shop.example.com/orders');
    expect(fs.existsSync(path.join(root, 'environments/_base.yaml'))).toBe(true);
    // and the schema they name, for editors
    expect(JSON.parse(read('.insomnium/folder.schema.json')).title).toContain('Insomnium collection');
  });

  it('takes in an edit made in the folder', async () => {
    write('Orders/List orders.yaml', read('Orders/List orders.yaml').replace('/orders', '/orders?limit=5'));

    await sync.reconcile();

    expect((await models.request.getById(requestId))?.url).toBe('https://shop.example.com/orders?limit=5');
  });

  it('takes in a new file, and gives it its id', async () => {
    write('Orders/Refund.yaml', 'type: Request\nname: Refund\nmethod: POST\nurl: https://shop.example.com/refunds\n');

    await sync.reconcile();

    const [refund] = (await models.request.findByParentId(folderId)).filter(request => request.name === 'Refund');
    expect(refund).toMatchObject({ method: 'POST', url: 'https://shop.example.com/refunds' });
    expect(read('Orders/Refund.yaml')).toContain(`_id: ${refund._id}`);
  });

  it('removes what was deleted from the folder', async () => {
    fs.rmSync(path.join(root, 'Orders/List orders.yaml'));

    await sync.reconcile();

    expect(await models.request.getById(requestId)).toBeNull();
    expect(await models.requestGroup.getById(folderId)).toBeTruthy();
  });

  it('writes out a change made in the app, and moves a renamed request', async () => {
    const request = await models.request.getById(requestId);
    await models.request.update(request!, { name: 'All orders', method: 'HEAD' });

    await sync.reconcile();

    expect(fs.existsSync(path.join(root, 'Orders/List orders.yaml'))).toBe(false);
    expect(read('Orders/All orders.yaml')).toContain('method: HEAD');
  });

  it('moves a request whose file moved to another folder', async () => {
    write('Archive/_folder.yaml', 'type: RequestGroup\nname: Archive\n');
    write('Archive/List orders.yaml', read('Orders/List orders.yaml'));
    fs.rmSync(path.join(root, 'Orders/List orders.yaml'));

    await sync.reconcile();

    const [archive] = (await models.requestGroup.findByParentId(workspaceId)).filter(folder => folder.name === 'Archive');
    expect((await models.request.getById(requestId))?.parentId).toBe(archive._id);
  });

  it('leaves other files in the folder alone', async () => {
    write('docker-compose.yaml', 'services: {}\n');
    write('.git/config', '[core]\n');

    await sync.reconcile();

    expect(read('docker-compose.yaml')).toBe('services: {}\n');
    expect((await models.request.findByParentId(workspaceId))).toEqual([]);
  });

  it("refuses a folder that has another collection's files", async () => {
    const other = (await models.workspace.create({ name: 'Other', parentId: 'proj_1' }))._id;

    await expect(new FolderSync(other, root).start()).rejects.toThrow('This folder has another collection, "Shop"');
  });

  it('takes in what changed in the folder while the app was closed', async () => {
    write('Orders/List orders.yaml', read('Orders/List orders.yaml').replace('List orders', 'Orders, all'));

    const reopened = new FolderSync(workspaceId, root);
    await reopened.start();
    reopened.stop();

    expect((await models.request.getById(requestId))?.name).toBe('Orders, all');
    expect(fs.existsSync(path.join(root, 'Orders/Orders, all.yaml'))).toBe(true);
  });
});
