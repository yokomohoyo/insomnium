import { afterEach, describe, expect, it, jest } from '@jest/globals';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import * as models from '../../models';
import { CredentialGuard, type KeyWrapper } from '../credential-guard';
import { credentialStorageStatus, database as db } from '../database';
import { SqliteStore } from '../sqlite-store';

const SECRET = 'tok-0123456789-secret';

const keychain = ({ failWrap = false } = {}) => {
  const wrapper = {
    wrap: jest.fn(async (key: Buffer) => {
      if (failWrap) {
        throw new Error('keychain denied');
      }
      return Buffer.from(`v11${key.toString('base64')}`).toString('base64');
    }),
    unwrap: jest.fn(async (wrapped: string) => ({ key: Buffer.from(Buffer.from(wrapped, 'base64').toString().slice(3), 'base64'), rewrap: false })),
    isWeak: () => false,
  };
  return wrapper as KeyWrapper & typeof wrapper;
};
const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'credentials-')), 'insomnia.sqlite');
// what is actually on disk, read without the guard
const rawJson = (file: string, id: string) => {
  const raw = new SqliteStore(file);
  try {
    return JSON.stringify((raw as any).raw(id));
  } finally {
    raw.close();
  }
};
const fileBytes = (file: string) => ['', '-wal'].map(suffix => fs.existsSync(file + suffix) ? fs.readFileSync(file + suffix).toString('latin1') : '').join('');
const tokenDoc = { _id: 'oa2_1', type: 'OAuth2Token', parentId: 'req_1', accessToken: SECRET, refreshToken: '', identityToken: '' };

describe('SqliteStore with a credential guard', () => {
  const guarded = async (file: string) => {
    const store = new SqliteStore(file);
    const guard = new CredentialGuard({ get: key => store.getMeta(key), set: (key, value) => store.setMeta(key, value) }, keychain());
    await guard.load();
    await guard.ensureKey();
    store.attachGuard(guard);
    return store;
  };

  it('writes ciphertext, returns and reads plaintext', async () => {
    const file = tempFile();
    const store = await guarded(file);
    expect(store.insert(tokenDoc).accessToken).toBe(SECRET);
    expect(store.update({ ...tokenDoc, refreshToken: 'r' })?.accessToken).toBe(SECRET);
    expect(store.upsert({ ...tokenDoc, _id: 'oa2_2' }).accessToken).toBe(SECRET);
    expect(store.find('OAuth2Token', { parentId: 'req_1' }).map(doc => doc.accessToken)).toEqual([SECRET, SECRET]);
    store.insert({ _id: 'req_1', type: 'Request', parentId: 'wrk_1' });
    expect(store.findDescendants('req_1').find(doc => doc._id === 'oa2_1')?.accessToken).toBe(SECRET);
    expect(store.count('OAuth2Token', { parentId: 'req_1' })).toBe(2);
    store.close();
    expect(rawJson(file, 'oa2_1')).not.toContain(SECRET);
    expect(rawJson(file, 'oa2_2')).not.toContain(SECRET);
  });

  it('encrypts credentials saved before, once, and compacting leaves no plaintext in the file', async () => {
    const file = tempFile();
    const plain = new SqliteStore(file);
    plain.insert(tokenDoc);
    plain.close();

    const store = await guarded(file);
    expect(store.hasUnsealedCredentials()).toBe(true);
    expect(store.sealCredentials()).toBe(1);
    expect(store.sealCredentials()).toBe(0);
    expect(store.hasUnsealedCredentials()).toBe(false);
    // the old page is still in the file until it's rewritten
    expect(fileBytes(file)).toContain(SECRET);
    store.compact();
    expect(fileBytes(file)).not.toContain(SECRET);
    expect(store.find('OAuth2Token')[0].accessToken).toBe(SECRET);
    store.close();
  });

  it('moves version 1 envelopes to 2, and then opens no version 1 one', async () => {
    const file = tempFile();
    const store = await guarded(file);
    store.insert(tokenDoc);
    // sealed as before 0.8.4: bound to the type and field only
    const [stored] = JSON.parse(store.getMeta('credentials.keys') as string);
    const key = Buffer.from(Buffer.from(stored.wrapped, 'base64').toString().slice(3), 'base64');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('OAuth2Token\0accessToken'));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(SECRET), 'utf8'), cipher.final()]);
    const legacy = { ...(store as any).raw('oa2_1'), accessToken: { $enc: 1, k: stored.id, v: Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64') } };
    const put = (doc: object) => (store as any).prepare('UPDATE docs SET json = ? WHERE _id = ?').run(JSON.stringify(doc), 'oa2_1');
    put(legacy);
    expect(store.find('OAuth2Token')[0].accessToken).toBe(SECRET);
    expect(store.hasUnsealedCredentials()).toBe(true);
    expect(store.sealCredentials()).toBe(1);
    expect((store as any).raw('oa2_1').accessToken.$enc).toBe(2);
    expect(store.find('OAuth2Token')[0].accessToken).toBe(SECRET);
    // the old row, put back, doesn't open
    put(legacy);
    expect(store.find('OAuth2Token')[0].accessToken).toBe('');
    store.close();
  });

  it('encrypts the plaintext in a doc that is partly encrypted already, leaving the rest', async () => {
    const store = await guarded(tempFile());
    store.insert(tokenDoc);
    // e.g. written back by an older version after a downgrade
    const mixed = { ...(store as any).raw('oa2_1'), refreshToken: 'typed in an older version' };
    (store as any).prepare('UPDATE docs SET json = ? WHERE _id = ?').run(JSON.stringify(mixed), 'oa2_1');
    expect(store.sealCredentials()).toBe(1);
    const [doc] = store.find('OAuth2Token');
    expect([doc.accessToken, doc.refreshToken]).toEqual([SECRET, 'typed in an older version']);
    expect((store as any).raw('oa2_1').accessToken).toEqual(mixed.accessToken);
    store.close();
  });
});

describe('database.init() with credentialKeys', () => {
  const realDataPath = process.env['INSOMNIA_DATA_PATH'];

  afterEach(async () => {
    if (realDataPath === undefined) {
      delete process.env['INSOMNIA_DATA_PATH'];
    } else {
      process.env['INSOMNIA_DATA_PATH'] = realDataPath;
    }
    await db.init(models.types(), { inMemoryOnly: true }, true, () => {});
  });

  const dataDir = () => {
    const dir = path.dirname(tempFile());
    process.env['INSOMNIA_DATA_PATH'] = dir;
    return { dir, file: path.join(dir, 'insomnia.sqlite') };
  };

  it('touches the keychain only once a credential is saved', async () => {
    dataDir();
    const wrapper = keychain();
    await db.init(models.types(), { credentialKeys: wrapper }, true, () => {});
    await models.request.create({ parentId: 'wrk_1', name: 'no credentials here' });
    await models.settings.getOrCreate();
    expect(wrapper.wrap).not.toHaveBeenCalled();
    expect(credentialStorageStatus().state).toBe('none');

    const settings = await models.settings.getOrCreate();
    await models.settings.update(settings, { githubToken: SECRET });
    expect(wrapper.wrap).toHaveBeenCalledTimes(1);
    expect(credentialStorageStatus().state).toBe('ready');
    expect((await models.settings.getOrCreate()).githubToken).toBe(SECRET);
  });

  it('encrypts credentials saved by an earlier version and still serves them in plaintext', async () => {
    const { file } = dataDir();
    await db.init(models.types(), {}, true, () => {});
    const settings = await models.settings.getOrCreate();
    await models.settings.update(settings, { githubToken: SECRET });
    expect(rawJson(file, settings._id)).toContain(SECRET);

    await db.init(models.types(), { credentialKeys: keychain() }, true, () => {});
    expect(rawJson(file, settings._id)).not.toContain(SECRET);
    expect(fileBytes(file)).not.toContain(SECRET);
    expect((await models.settings.getOrCreate()).githubToken).toBe(SECRET);
  });

  it('encrypts credentials imported from legacy NeDB files', async () => {
    const { dir, file } = dataDir();
    fs.writeFileSync(path.join(dir, 'insomnia.OAuth2Token.db'), JSON.stringify({ ...tokenDoc, created: 1, modified: 1 }) + '\n');
    await db.init(models.types(), { credentialKeys: keychain() }, true, () => {});
    expect((await db.get<any>('OAuth2Token', 'oa2_1'))?.accessToken).toBe(SECRET);
    expect(fileBytes(file)).not.toContain(SECRET);
  });

  it('seals what batchModifyDocs writes', async () => {
    const { file } = dataDir();
    await db.init(models.types(), { credentialKeys: keychain() }, true, () => {});
    await db.batchModifyDocs({ upsert: [{ ...tokenDoc, created: 1, modified: 1 } as any], remove: [] });
    expect(rawJson(file, 'oa2_1')).not.toContain(SECRET);
    expect((await db.get<any>('OAuth2Token', 'oa2_1'))?.accessToken).toBe(SECRET);
  });

  it('compacts once, clearing credentials an earlier version deleted but left in the file', async () => {
    const { file } = dataDir();
    // as an earlier version wrote it: no secure_delete
    const earlier = new SqliteStore(file);
    (earlier as any).db.exec('PRAGMA secure_delete = OFF;');
    earlier.insert(tokenDoc);
    earlier.removeByIds([tokenDoc._id]);
    earlier.close();
    expect(fileBytes(file)).toContain(SECRET);

    await db.init(models.types(), { credentialKeys: keychain() }, true, () => {});
    expect(fileBytes(file)).not.toContain(SECRET);
    expect(credentialStorageStatus().state).toBe('none');
    // and not again
    await db.init(models.types(), { inMemoryOnly: true }, true, () => {});
    const store = new SqliteStore(file);
    expect(store.getMeta('credentials.compacted')).toBe('1');
    store.close();
  });

  it('says when a save changes how credentials are stored', async () => {
    dataDir();
    const changed = jest.fn();
    await db.init(models.types(), { credentialKeys: keychain({ failWrap: true }), onCredentialStorageChange: changed }, true, () => {});
    const settings = await models.settings.getOrCreate();
    await models.settings.update(settings, { githubToken: SECRET });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(credentialStorageStatus().state).toBe('unavailable');
    // kept for the session
    expect((await models.settings.getOrCreate()).githubToken).toBe(SECRET);
  });

  it('sends change listeners plaintext', async () => {
    dataDir();
    await db.init(models.types(), { credentialKeys: keychain() }, true, () => {});
    const seen: string[] = [];
    db.onChange(async changes => {
      for (const [, doc] of changes) {
        if (doc.type === models.settings.type) {
          seen.push((doc as any).githubToken);
        }
      }
    });
    const settings = await models.settings.getOrCreate();
    await models.settings.update(settings, { githubToken: SECRET });
    await db.flushChanges();
    expect(seen).toContain(SECRET);
  });
});
