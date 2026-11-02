import { describe, expect, it, jest } from '@jest/globals';
import crypto from 'node:crypto';

import { CredentialGuard, isEnvelope, KeyWrapper, WrappedKey } from '../credential-guard';

// A stand-in for the OS keychain. `secret` is the machine's own keychain key: a
// keychain with another secret can't unwrap what this one wrapped. Weak wraps
// carry the 'v10' prefix like Electron's Linux fallback.
let wraps = 0;
const keychain = ({ secret = 'this-machine', weak = false, failWrap = false, failUnwrap = false, rewrap = false, hang = false, hangOn = [] as string[], wrapAs = '' } = {}) => {
  const never = new Promise<never>(() => {});
  const wrapper = {
    wrap: jest.fn(async (key: Buffer) => {
      if (hang) {
        return never;
      }
      if (failWrap) {
        throw new Error('keychain denied');
      }
      return Buffer.from([weak ? 'v10' : 'v11', wrapAs || secret, ++wraps, key.toString('base64')].join('|')).toString('base64');
    }),
    unwrap: jest.fn(async (wrapped: string) => {
      const [, owner, , key] = Buffer.from(wrapped, 'base64').toString().split('|');
      if (hang || hangOn.includes(owner)) {
        return never;
      }
      if (failUnwrap || owner !== secret) {
        throw new Error('keychain locked');
      }
      return { key: Buffer.from(key, 'base64'), rewrap };
    }),
    isWeak: (wrapped: string) => Buffer.from(wrapped, 'base64').toString().startsWith('v10'),
  };
  return wrapper as KeyWrapper & typeof wrapper;
};
const memoryMeta = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return { values, get: (key: string) => values.get(key) ?? null, set: (key: string, value: string) => void values.set(key, value) };
};
const storedKeys = (meta: ReturnType<typeof memoryMeta>) => JSON.parse(meta.values.get('credentials.keys') as string) as WrappedKey[];
const ready = async (wrapper = keychain(), meta = memoryMeta()) => {
  const guard = new CredentialGuard(meta, wrapper);
  await guard.load();
  await guard.ensureKey();
  return { guard, wrapper, meta };
};
// an envelope as versions before 0.8.4 sealed it: bound to the type and field only
const legacySeal = (meta: ReturnType<typeof memoryMeta>, type: string, field: string, value: unknown) => {
  const [stored] = storedKeys(meta);
  const key = Buffer.from(Buffer.from(stored.wrapped, 'base64').toString().split('|')[3], 'base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${type}\0${field}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { $enc: 1, k: stored.id, v: Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64') };
};
const token = (accessToken: unknown, extra = {}) => ({ _id: 'oa2_1', type: 'OAuth2Token', accessToken, refreshToken: '', identityToken: '', ...extra });

describe('CredentialGuard', () => {
  it('does not touch the keychain until a credential is saved', async () => {
    const wrapper = keychain();
    const guard = new CredentialGuard(memoryMeta(), wrapper);
    await guard.load();
    expect(guard.state).toBe('none');
    expect(guard.needsKey(token(''))).toBe(false);
    expect(guard.needsKey({ _id: 'req_1', type: 'Request', url: 'x' })).toBe(false);
    expect(guard.needsKey(token('abc'))).toBe(true);
    expect(wrapper.wrap).not.toHaveBeenCalled();
    expect(wrapper.unwrap).not.toHaveBeenCalled();
  });

  it('asks the keychain once when two credentials are first saved together', async () => {
    const wrapper = keychain();
    const meta = memoryMeta();
    const guard = new CredentialGuard(meta, wrapper);
    await guard.load();
    await Promise.all([guard.ensureKey(), guard.ensureKey()]);
    expect(wrapper.wrap).toHaveBeenCalledTimes(1);
    expect(storedKeys(meta)).toHaveLength(1);
  });

  it.each([
    ['a token', 'OAuth2Token', 'accessToken', 's3cret'],
    ['git credentials', 'GitRepository', 'credentials', { username: 'me', token: 's3cret', oauth2format: 'github' }],
    ['legacy workspace certificates', 'Workspace', 'certificates', [{ host: 'x', passphrase: 's3cret' }]],
  ])('stores %s encrypted and reads it back', async (_, type, field, value) => {
    const { guard } = await ready();
    const stored = guard.sealDoc({ _id: 'x_1', type, [field]: value }, null);
    expect(isEnvelope(stored[field])).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('s3cret');
    expect(guard.openDoc(stored)[field]).toEqual(value);
  });

  it('leaves empty values and other types alone', async () => {
    const { guard } = await ready();
    expect(guard.sealDoc(token(''), null)).toEqual(token(''));
    const request = { _id: 'req_1', type: 'Request', authentication: { token: 'not in scope' } };
    expect(guard.sealDoc(request, null)).toBe(request);
  });

  it('keeps the stored ciphertext for an unchanged credential', async () => {
    const { guard } = await ready();
    const stored = guard.sealDoc(token('abc'), null);
    expect(guard.sealDoc(guard.openDoc(stored), stored).accessToken).toEqual(stored.accessToken);
    expect(guard.sealDoc(token('changed'), stored).accessToken).not.toEqual(stored.accessToken);
  });

  it('binds ciphertext to its field', async () => {
    const { guard } = await ready();
    const stored = guard.sealDoc(token('abc'), null);
    expect(guard.openDoc({ ...stored, refreshToken: stored.accessToken }).refreshToken).toBe('');
  });

  it('binds ciphertext to its doc', async () => {
    const { guard } = await ready();
    const stored = guard.sealDoc(token('abc'), null);
    expect(stored.accessToken.$enc).toBe(2);
    expect(guard.openDoc({ ...stored, _id: 'oa2_2' }).accessToken).toBe('');
    expect(guard.openDoc(stored).accessToken).toBe('abc');
  });

  it('opens a version 1 envelope until the startup pass has moved them all to 2', async () => {
    const meta = memoryMeta();
    const { guard } = await ready(keychain(), meta);
    const legacy = token(legacySeal(meta, 'OAuth2Token', 'accessToken', 'abc'));
    expect(guard.openDoc(legacy).accessToken).toBe('abc');
    expect(guard.needsSealing(legacy)).toBe(true);
    expect(guard.hasLegacyEnvelope(legacy)).toBe(true);
    const resealed = guard.sealDoc(guard.openDoc(legacy), legacy);
    expect(resealed.accessToken.$enc).toBe(2);
    expect(guard.hasLegacyEnvelope(resealed)).toBe(false);

    guard.retireLegacyEnvelopes();
    expect(guard.openDoc(legacy).accessToken).toBe('');
    expect(guard.needsSealing(legacy)).toBe(false);
    // and in the sessions after
    const { guard: next } = await ready(keychain(), meta);
    expect(next.openDoc(legacy).accessToken).toBe('');
    expect(next.openDoc(resealed).accessToken).toBe('abc');
  });

  it('encrypts input that merely looks encrypted', async () => {
    const { guard } = await ready();
    const planted = { $enc: 1, k: 'attacker', v: 'whatever' };
    const stored = guard.sealDoc(token(planted), null);
    expect(stored.accessToken).not.toEqual(planted);
    expect(guard.openDoc(stored).accessToken).toEqual(planted);
  });

  it('re-seals a doc mixing plaintext and ciphertext without sealing the ciphertext again', async () => {
    const { guard } = await ready();
    const stored = guard.sealDoc(token('abc'), null);
    const mixed = { ...stored, refreshToken: 'from an older version' };
    expect(guard.needsSealing(mixed)).toBe(true);
    const resealed = guard.sealDoc(guard.openDoc(mixed), mixed);
    expect(resealed.accessToken).toEqual(stored.accessToken);
    expect(guard.openDoc(resealed)).toEqual(token('abc', { refreshToken: 'from an older version' }));
    expect(guard.needsSealing(resealed)).toBe(false);
  });

  it('reads a credential it cannot decrypt as empty, and writing that back keeps it', async () => {
    const meta = memoryMeta();
    const { guard: first } = await ready(keychain(), meta);
    const stored = first.sealDoc(token('abc'), null);
    // a later session whose keychain can't unwrap the key
    const locked = new CredentialGuard(meta, keychain({ failUnwrap: true }));
    await locked.load();
    expect(locked.state).toBe('locked');
    const opened = locked.openDoc(stored);
    expect(opened.accessToken).toBe('');
    expect(locked.sealDoc(opened, stored).accessToken).toEqual(stored.accessToken);
  });

  it.each([
    ['locked', { failUnwrap: true }],
    ['unavailable', { failWrap: true }],
  ])('when %s, keeps new credentials for the session only, never on disk', async (state, options) => {
    const meta = memoryMeta();
    if (state === 'locked') {
      const { guard } = await ready(keychain(), meta);
      guard.sealDoc(token('old'), null);
    }
    const guard = new CredentialGuard(meta, keychain(options));
    await guard.load();
    await guard.ensureKey();
    expect(guard.state).toBe(state);
    const stored = guard.sealDoc(token('typed this session'), null);
    expect(JSON.stringify(stored)).not.toContain('typed this session');
    expect(guard.openDoc(stored).accessToken).toBe('typed this session');
  });

  it('when unavailable, keeps plaintext saved before this version rather than losing it', async () => {
    const guard = new CredentialGuard(memoryMeta(), keychain({ failWrap: true }));
    await guard.load();
    await guard.ensureKey();
    const before = token('from an older version');
    expect(guard.sealDoc({ ...before, modified: 2 }, before).accessToken).toBe('from an older version');
    // a workspace write drops its legacy certificates; they stay until they can be extracted and saved
    const workspace = { _id: 'wrk_1', type: 'Workspace', certificates: [{ host: 'x', passphrase: 'p' }] };
    const renamed: { _id: string; type: string; [key: string]: unknown } = { _id: 'wrk_1', type: 'Workspace', name: 'renamed' };
    expect(guard.sealDoc(renamed, workspace).certificates).toEqual(workspace.certificates);
  });

  it('reports a keychain that only obfuscates as weak', async () => {
    expect((await ready(keychain({ weak: true }))).guard.state).toBe('weak');
  });

  it('re-wraps the key when the keychain asks', async () => {
    const meta = memoryMeta();
    await ready(keychain(), meta);
    const [before] = storedKeys(meta);
    const wrapper = keychain({ rewrap: true });
    const guard = new CredentialGuard(meta, wrapper);
    await guard.load();
    expect(guard.state).toBe('ready');
    expect(wrapper.wrap).toHaveBeenCalledTimes(1);
    const after = storedKeys(meta);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].wrapped).not.toBe(before.wrapped);
  });

  it('starts a new key when this keychain can never open the saved one (another computer)', async () => {
    const meta = memoryMeta();
    const { guard: first } = await ready(keychain({ secret: 'old-computer' }), meta);
    const stored = first.sealDoc(token('abc'), null);
    const [lost] = storedKeys(meta);

    const guard = new CredentialGuard(meta, keychain({ secret: 'new-computer' }));
    await guard.load();
    expect(guard.state).toBe('ready');
    expect(guard.unreadableKeys).toEqual([lost.id]);
    // the old key is kept in case that keychain comes back
    expect(storedKeys(meta).map(key => key.id)).toEqual([lost.id, expect.any(String)]);
    expect(guard.openDoc(stored).accessToken).toBe('');
    expect(guard.sealDoc(token(''), stored).accessToken).toEqual(stored.accessToken);
    // re-entered credentials are saved again
    const reentered = guard.sealDoc(token('new'), stored);
    expect(isEnvelope(reentered.accessToken)).toBe(true);
    const later = new CredentialGuard(meta, keychain({ secret: 'new-computer' }));
    await later.load();
    expect(later.openDoc(reentered).accessToken).toBe('new');
  });

  it('treats a key that fails its check as unreadable and starts a new one', async () => {
    const meta = memoryMeta();
    await ready(keychain(), meta);
    const keys = storedKeys(meta);
    keys[0].check = 'not-the-check';
    meta.set('credentials.keys', JSON.stringify(keys));
    const guard = new CredentialGuard(meta, keychain());
    await guard.load();
    expect(guard.state).toBe('ready');
    expect(guard.unreadableKeys).toEqual([keys[0].id]);
  });

  it('stays locked rather than replace a keyring key with the weak fallback', async () => {
    const meta = memoryMeta();
    await ready(keychain({ secret: 'keyring' }), meta);
    // the keyring isn't running this session: only the built-in fallback answers
    const guard = new CredentialGuard(meta, keychain({ secret: 'fallback', weak: true }));
    await guard.load();
    expect(guard.state).toBe('locked');
    expect(storedKeys(meta)).toHaveLength(1);
  });

  it('moves to a new key once a keyring replaces the weak fallback', async () => {
    const meta = memoryMeta();
    const { guard: weak } = await ready(keychain({ weak: true }), meta);
    expect(weak.state).toBe('weak');
    const stored = weak.sealDoc(token('abc'), null);

    const guard = new CredentialGuard(meta, keychain());
    await guard.load();
    expect(guard.state).toBe('ready');
    expect(storedKeys(meta)).toHaveLength(2);
    // the startup pass moves what the weak key sealed
    expect(guard.needsSealing(stored)).toBe(true);
    const moved = guard.sealDoc(guard.openDoc(stored), stored);
    expect((moved.accessToken as { k: string }).k).toBe(storedKeys(meta)[1].id);
    expect(guard.openDoc(moved).accessToken).toBe('abc');
    expect(guard.needsSealing(moved)).toBe(false);
  });

  it('gives up on a keychain that does not answer, after one wait', async () => {
    const meta = memoryMeta();
    for (const secret of ['a', 'b', 'c']) {
      await ready(keychain({ secret }), meta);
    }
    expect(storedKeys(meta)).toHaveLength(3);
    const hung = keychain({ hang: true });
    const locked = new CredentialGuard(meta, hung, 20);
    await locked.load();
    expect(locked.state).toBe('locked');
    // one unwrap (the newest key), no replacement key, and nothing called unreadable
    expect(hung.unwrap).toHaveBeenCalledTimes(1);
    expect(hung.wrap).not.toHaveBeenCalled();
    expect(locked.unreadableKeys).toEqual([]);

    const fresh = new CredentialGuard(memoryMeta(), keychain({ hang: true }), 20);
    await fresh.load();
    await fresh.ensureKey();
    expect(fresh.state).toBe('unavailable');
  });

  it('does not call a key that only timed out unreadable', async () => {
    const meta = memoryMeta();
    await ready(keychain({ secret: 'a' }), meta);
    await ready(keychain({ secret: 'b' }), meta);
    const guard = new CredentialGuard(meta, keychain({ secret: 'b', hangOn: ['a'] }), 20);
    await guard.load();
    expect(guard.state).toBe('ready');
    expect(guard.unreadableKeys).toEqual([]);
  });

  it('goes back to its own key when a data folder moves between two keychains', async () => {
    const meta = memoryMeta();
    const a = keychain({ secret: 'a' });
    const b = keychain({ secret: 'b' });
    const { guard: first } = await ready(a, meta);
    const fromA = first.sealDoc(token('typed on a'), null);
    for (const wrapper of [b, a, b, a]) {
      const guard = new CredentialGuard(meta, wrapper);
      await guard.load();
      expect(guard.state).toBe('ready');
    }
    expect(storedKeys(meta)).toHaveLength(2);
    const back = new CredentialGuard(meta, a);
    await back.load();
    expect(back.openDoc(fromA).accessToken).toBe('typed on a');
  });

  it('keeps the old wrap when a re-wrap would not open again', async () => {
    const meta = memoryMeta();
    await ready(keychain(), meta);
    const [before] = storedKeys(meta);
    const guard = new CredentialGuard(meta, keychain({ rewrap: true, wrapAs: 'somewhere-else' }));
    await guard.load();
    expect(guard.state).toBe('ready');
    expect(storedKeys(meta)[0].wrapped).toBe(before.wrapped);
  });

  it('still moves off a once-weak key that a keyring has re-wrapped', async () => {
    const meta = memoryMeta();
    await ready(keychain({ weak: true }), meta);
    const [weakKey] = storedKeys(meta);
    expect(weakKey.weak).toBe(true);
    // re-wrapped by the keyring on an earlier launch whose move to a new key failed
    const strong = keychain();
    const { key } = await keychain({ weak: true }).unwrap(weakKey.wrapped);
    meta.set('credentials.keys', JSON.stringify([{ ...weakKey, wrapped: await strong.wrap(key) }]));
    const guard = new CredentialGuard(meta, strong);
    await guard.load();
    expect(guard.state).toBe('ready');
    expect(storedKeys(meta)).toHaveLength(2);
  });

  it('replaces a lost weak key with a weak one where only the fallback exists', async () => {
    const meta = memoryMeta();
    await ready(keychain({ secret: 'old', weak: true }), meta);
    const guard = new CredentialGuard(meta, keychain({ secret: 'new', weak: true }));
    await guard.load();
    expect(guard.state).toBe('weak');
    expect(storedKeys(meta)).toHaveLength(2);
  });

  it('reads a truncated or short-tagged envelope as empty', async () => {
    const { guard } = await ready();
    const stored = guard.sealDoc(token('abc'), null);
    const envelope = stored.accessToken as { v: string };
    const raw = Buffer.from(envelope.v, 'base64');
    expect(guard.openDoc({ ...stored, accessToken: { ...envelope, v: raw.subarray(0, 20).toString('base64') } }).accessToken).toBe('');
    expect(guard.openDoc({ ...stored, accessToken: { ...envelope, v: raw.subarray(0, raw.length - 12).toString('base64') } }).accessToken).toBe('');
  });

  it('holds back legacy certificates while locked, so they are not extracted on every read', async () => {
    const guard = new CredentialGuard(memoryMeta(), keychain({ failWrap: true }));
    await guard.load();
    await guard.ensureKey();
    expect(guard.state).toBe('unavailable');
    const workspace = { _id: 'wrk_1', type: 'Workspace', certificates: [{ host: 'x', passphrase: 'p' }] };
    expect(guard.openDoc(workspace).certificates).toEqual([]);
  });
});
