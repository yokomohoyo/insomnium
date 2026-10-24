import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { isGitSyncedType } from '../../sync/git/ne-db-client';
import { environmentFromRows, rowsFromEnvironment } from '../../ui/components/editors/environment-variables';
import { CREDENTIAL_FIELDS } from '../credential-guard';
import { setEnvironmentData, splitSecrets, withSecretValues } from '../environment-secrets';
import { exportWorkspacesData } from '../export-data';
import { getRenderContext, render } from '../render';

describe('splitting secrets from an environment', () => {
  it("empties a secret's value in the data, keeping the one it had", () => {
    expect(splitSecrets({ host: 'a.example.com', token: '' }, ['token'], { token: 'hunter2' })).toEqual({
      data: { host: 'a.example.com', token: '' }, secretKeys: ['token'], secrets: { token: 'hunter2' },
    });
  });

  it('takes a value in the data as a new one, as the JSON view or a script sets it', () => {
    expect(splitSecrets({ token: 'new', count: 3 }, ['token', 'count'], { token: 'old' })).toEqual({
      data: { token: '', count: '' }, secretKeys: ['token', 'count'], secrets: { token: 'new', count: '3' },
    });
  });

  it('forgets secrets whose variable is gone, and names given twice', () => {
    expect(splitSecrets({ a: '' }, ['a', 'a', 'gone'], { a: 'x', gone: 'y' })).toEqual({ data: { a: '' }, secretKeys: ['a'], secrets: { a: 'x' } });
  });

  it('is never synced, and is encrypted at rest', () => {
    expect(isGitSyncedType(models.environmentSecret.type)).toBe(false);
    expect(CREDENTIAL_FIELDS[models.environmentSecret.type]).toEqual(['values']);
  });
});

describe('an environment with secret variables', () => {
  beforeEach(globalBeforeEach);

  const setup = async () => {
    const workspace = await models.workspace.create({ name: 'Shop', scope: 'collection' });
    const base = await models.environment.getOrCreateForParentId(workspace._id);
    await models.environment.update(base, { data: { host: 'shop.example.com', token: '' }, secretKeys: ['token'] });
    await models.environmentSecret.setValues(base._id, { token: 'hunter2' });
    const request = await models.request.create({ parentId: workspace._id, url: 'https://{{ host }}/orders', headers: [{ name: 'Authorization', value: 'Bearer {{ token }}' }] });
    return { workspace, base: (await models.environment.getById(base._id))!, request };
  };

  it("gives requests the secret's value", async () => {
    const { base, request } = await setup();
    expect((await withSecretValues(base))!.data).toEqual({ host: 'shop.example.com', token: 'hunter2' });
    const context = await getRenderContext({ request, environment: base._id });
    expect(await render('Bearer {{ token }}', context)).toBe('Bearer hunter2');
  });

  it("keeps a value set by a script or the MCP server in its secrets, not the data", async () => {
    const { base } = await setup();
    await setEnvironmentData(base, { host: 'shop.example.com', token: 'rotated', added: 'x' });
    const saved = (await models.environment.getById(base._id))!;
    expect(saved.data).toEqual({ host: 'shop.example.com', token: '', added: 'x' });
    expect(saved.secretKeys).toEqual(['token']);
    expect((await models.environmentSecret.getByParentId(base._id))!.values).toEqual({ token: 'rotated' });
  });

  it('exports with the name and an empty value, never the secret', async () => {
    const { workspace } = await setup();
    const exported = await exportWorkspacesData([workspace], false, 'json');
    expect(exported).not.toMatch(/hunter2/);
    const environment = JSON.parse(exported).resources.find((resource: { _type: string }) => resource._type === 'environment');
    expect(environment).toMatchObject({ data: { token: '' }, secretKeys: ['token'] });
  });

  it("leaves an environment without secrets as it was, without the new key", async () => {
    const workspace = await models.workspace.create({ name: 'Plain' });
    const base = await models.environment.getOrCreateForParentId(workspace._id);
    await setEnvironmentData(base, { a: '1' });
    expect((await models.environment.getById(base._id))!).not.toHaveProperty('secretKeys');
  });
});

describe('secret variables in the table', () => {
  it('shows their values, as text, marked secret', () => {
    const rows = rowsFromEnvironment({ object: { host: 'h', token: '' }, propertyOrder: null, secretKeys: ['token'], secrets: { token: 'hunter2' } });
    expect(rows.map(({ id, ...row }) => row)).toEqual([
      { name: 'host', value: 'h', type: 'text' },
      { name: 'token', value: 'hunter2', type: 'text', secret: true },
    ]);
  });

  it('saves them apart, with the name in the environment', () => {
    const result = environmentFromRows([
      { id: '1', name: 'host', value: 'h', type: 'text' },
      { id: '2', name: 'token', value: 'hunter2', type: 'text', secret: true },
    ]);
    expect(result.info).toMatchObject({ object: { host: 'h', token: '' }, secretKeys: ['token'], secrets: { token: 'hunter2' } });
  });
});
