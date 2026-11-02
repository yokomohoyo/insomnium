// Encrypts saved credentials at rest. The SQLite store calls sealDoc on every
// write and openDoc on every read, so everything above it (the renderer,
// exports, plugins, MCP) keeps seeing plaintext while insomnia.sqlite only
// holds ciphertext. One data key encrypts each field with AES-256-GCM; the key
// itself is wrapped by the OS keychain (Electron safeStorage, main process
// only), which is injected so this file stays free of Electron.

import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const CREDENTIAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  GitRepository: ['credentials'],
  OAuth2Token: ['accessToken', 'refreshToken', 'identityToken'],
  ClientCertificate: ['passphrase'],
  EnvironmentSecret: ['values'],
  Settings: ['githubToken', 'bufToken', 'mcpToken', 'aiApiKey', 'teamServers'],
  WorkspaceMeta: ['githubToken', 'bufToken'],
  // legacy: imported NeDB rows can still carry passphrases here
  Workspace: ['certificates'],
};

// 1: bound to the doc's type and field only, from before 0.8.4; read until the
// startup pass has moved every one to 2, which binds the doc's _id as well
export interface Envelope {
  $enc: 1 | 2;
  k: string;
  v: string;
}

export interface WrappedKey {
  id: string;
  wrapped: string;
  check: string;
  // first wrapped by the weak fallback: replaced once a keyring is available
  weak?: true;
}

export interface KeyWrapper {
  wrap(key: Buffer): Promise<string>;
  unwrap(wrapped: string): Promise<{ key: Buffer; rewrap: boolean }>;
  // a wrap that only obfuscates (Linux without a keyring)
  isWeak(wrapped: string): boolean;
}

export interface GuardMeta {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

// none: nothing saved yet, so no key (and no keychain prompt)
// ready / weak: encrypting; weak = the keychain wrap is only obfuscation
// locked: a key exists but this session can't unwrap it
// unavailable: the keychain refused to create a key
export type GuardState = 'none' | 'ready' | 'weak' | 'locked' | 'unavailable';

const KEYS_META = 'credentials.keys';
// set once no version 1 envelope is left, after which none opens
const ENVELOPES_META = 'credentials.envelopes';
// how long to wait on the keychain before carrying on without it this session
export const KEYCHAIN_TIMEOUT_MS = 30_000;
interface Doc {
  _id: string;
  type: string;
  [key: string]: any;
}

const isEmpty = (value: unknown) => value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
export const isEnvelope = (value: unknown): value is Envelope =>
  !!value && typeof value === 'object' && ((value as Envelope).$enc === 1 || (value as Envelope).$enc === 2) && typeof (value as Envelope).k === 'string' && typeof (value as Envelope).v === 'string';
// what a field reads as when its envelope can't be opened
const placeholder = (field: string) => (field === 'credentials' ? null : field === 'certificates' ? [] : '');
const keyCheck = (key: Buffer) => crypto.createHmac('sha256', key).update('insomnium-key-check').digest('base64').slice(0, 22);
const aad = (version: Envelope['$enc'], doc: Doc, field: string) =>
  Buffer.from(version === 1 ? `${doc.type}\0${field}` : `${doc.type}\0${doc._id}\0${field}`);

class KeychainTimeout extends Error {}

export class CredentialGuard {
  private keys = new Map<string, Buffer>();
  private currentKeyId: string | null = null;
  private storedKeys: WrappedKey[] = [];
  // credentials entered while the keychain is unavailable: kept for the session only
  private sessionValues = new Map<string, unknown>();
  private creating: Promise<void> | null = null;
  private legacyRetired = false;
  state: GuardState = 'none';
  // saved keys this keychain can't open: made on another computer or account, or
  // under a keychain since reset. Their credentials read as empty.
  unreadableKeys: string[] = [];

  constructor(private readonly meta: GuardMeta, private readonly wrapper: KeyWrapper, private readonly timeoutMs = KEYCHAIN_TIMEOUT_MS) {}

  // An unanswered prompt or a stalled D-Bus call must not hold up startup or a save.
  private keychain<T>(call: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new KeychainTimeout(`no answer from the keychain in ${this.timeoutMs} ms`)), this.timeoutMs);
    });
    return Promise.race([Promise.resolve().then(call), timeout]).finally(() => clearTimeout(timer));
  }

  // Unwraps existing keys. Touches the keychain only if a key was saved before.
  async load() {
    this.storedKeys = JSON.parse(this.meta.get(KEYS_META) || '[]') as WrappedKey[];
    this.legacyRetired = this.meta.get(ENVELOPES_META) === '2';
    if (!this.storedKeys.length) {
      this.state = 'none';
      return;
    }
    const newest = this.storedKeys[this.storedKeys.length - 1];
    // a key that was ever only obfuscated stays suspect, even once re-wrapped by a keyring
    const wasWeak = new Set(this.storedKeys.filter(stored => stored.weak || this.wrapper.isWeak(stored.wrapped)).map(stored => stored.id));
    // newest first, and no more keychain calls once it stops answering
    let timedOut = false;
    const unanswered = new Set<string>();
    for (const stored of [...this.storedKeys].reverse()) {
      if (timedOut) {
        unanswered.add(stored.id);
        continue;
      }
      try {
        const { key, rewrap } = await this.keychain(() => this.wrapper.unwrap(stored.wrapped));
        if (keyCheck(key) !== stored.check) {
          throw new Error('key check failed');
        }
        this.keys.set(stored.id, key);
        if (rewrap) {
          timedOut = await this.rewrap(stored, key);
        }
      } catch (err) {
        if (err instanceof KeychainTimeout) {
          timedOut = true;
          unanswered.add(stored.id);
        }
        console.warn(`[credentials] Could not unwrap key ${stored.id}`, (err as Error).message);
      }
    }
    this.meta.set(KEYS_META, JSON.stringify(this.storedKeys));
    this.unreadableKeys = this.storedKeys.filter(stored => !this.keys.has(stored.id) && !unanswered.has(stored.id)).map(stored => stored.id);

    // The newest key this session can open. An obfuscated key doesn't stand in for a
    // keyring key that can't be opened right now (a keyring that isn't running yet).
    const usable = [...this.storedKeys].reverse().find(stored => this.keys.has(stored.id));
    if (usable && (!wasWeak.has(usable.id) || wasWeak.has(newest.id))) {
      this.adopt(usable.id, usable.wrapped);
      // A keyring now protects what was only obfuscated. The old key stays unwrappable
      // from any copy of the data folder taken meanwhile (backups/ among them), so new
      // credentials get a new key and the startup pass moves the old ones to it.
      if (wasWeak.has(usable.id) && !timedOut) {
        const fresh = await this.newKey();
        if (fresh && !this.wrapper.isWeak(fresh.wrapped)) {
          this.store(fresh);
        }
      }
      return;
    }
    // The keychain works but can open none of the keys, so it never will: start a new
    // one, and keep the old in case that keychain comes back. Only the weak fallback
    // answering means a keyring that isn't running this session: locked, not lost.
    if (!usable && !timedOut) {
      const fresh = await this.newKey();
      if (fresh && (wasWeak.has(newest.id) || !this.wrapper.isWeak(fresh.wrapped))) {
        this.store(fresh);
        return;
      }
    }
    this.state = 'locked';
  }

  // Re-wraps a key the keychain asked to, keeping the new wrap only once it opens.
  // Returns whether the keychain stopped answering.
  private async rewrap(stored: WrappedKey, key: Buffer) {
    try {
      const rewrapped = await this.keychain(() => this.wrapper.wrap(key));
      if ((await this.keychain(() => this.wrapper.unwrap(rewrapped))).key.equals(key)) {
        stored.wrapped = rewrapped;
      }
      return false;
    } catch (err) {
      console.warn(`[credentials] Could not re-wrap key ${stored.id}`, (err as Error).message);
      return err instanceof KeychainTimeout;
    }
  }

  // Lazily creates the data key the first time a credential is saved. Concurrent
  // first saves share one attempt, so the keychain is asked once.
  ensureKey() {
    if (this.state !== 'none') {
      return Promise.resolve();
    }
    this.creating = this.creating || this.newKey().then(fresh => {
      if (fresh) {
        this.store(fresh);
      } else {
        this.state = 'unavailable';
      }
    }).finally(() => {
      this.creating = null;
    });
    return this.creating;
  }

  // A new data key, wrapped and unwrapped once to prove the keychain can give it back.
  private async newKey(): Promise<{ key: Buffer; wrapped: string } | null> {
    const key = crypto.randomBytes(32);
    try {
      const wrapped = await this.keychain(() => this.wrapper.wrap(key));
      if (!(await this.keychain(() => this.wrapper.unwrap(wrapped))).key.equals(key)) {
        throw new Error('the keychain returned a different key');
      }
      return { key, wrapped };
    } catch (err) {
      console.warn('[credentials] The system keychain refused a key; credentials stay in memory this session', (err as Error).message);
      return null;
    }
  }

  private store({ key, wrapped }: { key: Buffer; wrapped: string }) {
    const id = crypto.randomBytes(6).toString('hex');
    this.storedKeys.push({ id, wrapped, check: keyCheck(key), ...(this.wrapper.isWeak(wrapped) ? { weak: true as const } : {}) });
    this.meta.set(KEYS_META, JSON.stringify(this.storedKeys));
    this.keys.set(id, key);
    this.adopt(id, wrapped);
  }

  private adopt(id: string, wrapped: string) {
    this.currentKeyId = id;
    this.state = this.wrapper.isWeak(wrapped) ? 'weak' : 'ready';
  }

  // Whether writing doc would need a key that hasn't been created yet.
  needsKey(doc: Doc) {
    return this.state === 'none' && this.needsSealing(doc);
  }

  // Stops opening version 1 envelopes, once the store holds none.
  retireLegacyEnvelopes() {
    this.legacyRetired = true;
    this.meta.set(ENVELOPES_META, '2');
  }

  hasLegacyEnvelope(doc: Doc) {
    return (CREDENTIAL_FIELDS[doc.type] || []).some(field => isEnvelope(doc[field]) && doc[field].$enc === 1);
  }

  private seal(doc: Doc, field: string, value: unknown): Envelope {
    const key = this.keys.get(this.currentKeyId as string) as Buffer;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(2, doc, field));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { $enc: 2, k: this.currentKeyId as string, v: Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64') };
  }

  private open(doc: Doc, field: string, envelope: Envelope): unknown {
    if (envelope.$enc === 1 && this.legacyRetired) {
      throw new Error('a version 1 envelope after all were moved to 2');
    }
    const key = this.keys.get(envelope.k);
    if (!key) {
      throw new Error(`no key ${envelope.k}`);
    }
    const raw = Buffer.from(envelope.v, 'base64');
    if (raw.length < 12 + 16) {
      throw new Error('truncated ciphertext');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12), { authTagLength: 16 });
    decipher.setAAD(aad(envelope.$enc, doc, field));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8'));
  }

  private tryOpen(doc: Doc, field: string, value: unknown): { opened: unknown } | null {
    try {
      return isEnvelope(value) ? { opened: this.open(doc, field, value) } : null;
    } catch {
      return null;
    }
  }

  private canOpen(doc: Doc, field: string, value: unknown) {
    return this.tryOpen(doc, field, value) !== null;
  }

  // The copy of doc to store. previous is the row as stored now, if any.
  sealDoc<T extends Doc>(doc: T, previous: Doc | null): T {
    const fields = CREDENTIAL_FIELDS[doc.type];
    if (!fields) {
      return doc;
    }
    const stored: Doc = { ...doc };
    const encrypting = this.state === 'ready' || this.state === 'weak';
    for (const field of fields) {
      const value = doc[field];
      const before = previous?.[field];
      const sessionKey = `${doc._id}\0${field}`;
      if (isEmpty(value)) {
        this.sessionValues.delete(sessionKey);
        // an unreadable credential reads as empty; writing that back must not destroy it
        if (isEnvelope(before) && !this.canOpen(doc, field, before)) {
          stored[field] = before;
        }
        // Workspace drops its legacy certificates on every write once they're extracted
        // to ClientCertificates; while those can't be saved, keep the originals
        if (field === 'certificates' && !encrypting && !isEmpty(before)) {
          stored[field] = before;
        }
        continue;
      }
      if (encrypting) {
        this.sessionValues.delete(sessionKey);
        // unchanged: keep the stored ciphertext rather than re-encrypting on every
        // write, unless it's under an older key or version
        const current = this.tryOpen(doc, field, before);
        const keep = current && (before as Envelope).k === this.currentKeyId && (before as Envelope).$enc === 2 && isDeepStrictEqual(current.opened, value);
        stored[field] = keep ? before : this.seal(doc, field, value);
      } else if (!isDeepStrictEqual(value, before)) {
        // never write a new credential in plaintext: keep it for this session
        // and leave whatever was stored (plaintext from before this version, or ciphertext)
        this.sessionValues.set(sessionKey, value);
        stored[field] = before === undefined ? placeholder(field) : before;
      }
    }
    return stored as T;
  }

  // The plaintext view of a stored doc.
  openDoc<T extends Doc>(doc: T): T {
    const fields = CREDENTIAL_FIELDS[doc.type];
    if (!fields) {
      return doc;
    }
    const opened: Doc = { ...doc };
    for (const field of fields) {
      const sessionKey = `${doc._id}\0${field}`;
      if (field === 'certificates' && (this.state === 'locked' || this.state === 'unavailable')) {
        // Workspace extracts its legacy certificates into ClientCertificates on every
        // read until a write drops them; they wait for a launch that can save the
        // passphrases (sealDoc keeps the originals until then)
        opened[field] = placeholder(field);
      } else if (this.sessionValues.has(sessionKey)) {
        opened[field] = this.sessionValues.get(sessionKey);
      } else if (isEnvelope(doc[field])) {
        try {
          opened[field] = this.open(doc, field, doc[field]);
        } catch (err) {
          // a missing key was reported once by load(); a failed decrypt means tampering
          if (this.keys.has(doc[field].k)) {
            console.warn(`[credentials] Could not decrypt ${doc.type} ${doc._id} ${field}`, (err as Error).message);
          }
          opened[field] = placeholder(field);
        }
      }
    }
    return opened as T;
  }

  // Docs the startup pass should rewrite: credentials in plaintext from before
  // encryption, or under an older key or version this session can open.
  needsSealing(doc: Doc) {
    return (CREDENTIAL_FIELDS[doc.type] || []).some(field => {
      const value = doc[field];
      return !isEmpty(value) && (!isEnvelope(value) || ((value.k !== this.currentKeyId || value.$enc === 1) && this.canOpen(doc, field, value)));
    });
  }
}
