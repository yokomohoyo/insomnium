// The team server's records (see team/index.ts): its accounts and their access
// tokens, its collections (each a Git repository it serves) and who may use
// each, and an audit log. One SQLite file in the data folder, through Node's
// own node:sqlite. Passwords are scrypt hashes; tokens are kept as SHA-256
// hashes, shown once when made.
import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
type DatabaseSync = import('node:sqlite').DatabaseSync;

export type CollectionRole = 'viewer' | 'editor' | 'owner';
export const ROLES: CollectionRole[] = ['viewer', 'editor', 'owner'];
const RANK: Record<CollectionRole, number> = { viewer: 1, editor: 2, owner: 3 };
export const atLeast = (role: CollectionRole | null, needed: CollectionRole) => !!role && RANK[role] >= RANK[needed];

export interface User {
  name: string;
  admin: boolean;
  created: number;
}

export interface Collection {
  slug: string;
  name: string;
  created: number;
  createdBy: string;
}

export interface AuditEntry {
  id: number;
  at: number;
  user: string;
  action: string;
  collection: string | null;
  detail: Record<string, unknown>;
}

// names that work in a URL and a path: a user's, a collection's slug
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const isName = (name: unknown): name is string => typeof name === 'string' && NAME.test(name) && !name.endsWith('.git') && !name.includes('..');

// a collection's slug from its name: lowercase words joined by dashes
export const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'collection';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) => Promise<Buffer>;
// off the event loop, so sign-ins don't hold up every other request
export async function checkPassword(password: string, stored: string) {
  const [kind, n, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) {
    return false;
  }
  const expected = Buffer.from(hash, 'base64');
  const given = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return timingSafeEqual(given, expected);
}
// checked against for a user who isn't there, so that takes as long as a wrong password
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
// an access token: ist_ and 32 random bytes, so it's told apart from a password
export const TOKEN_PREFIX = 'ist_';
const newToken = () => `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
export const newPassword = () => randomBytes(18).toString('base64url');
// no password matches it: checkPassword takes only scrypt hashes
const NO_PASSWORD = '!';
// a token not used for this long stops working
export const TOKEN_IDLE_MS = 180 * 24 * 60 * 60_000;

export class TeamStore {
  readonly db: DatabaseSync;

  constructor(dataDir: string) {
    // getBuiltinModule loads node:sqlite even under module systems that don't know it (e.g. jest)
    const getBuiltin = (process as NodeJS.Process & { getBuiltinModule: (id: string) => unknown }).getBuiltinModule;
    const { DatabaseSync: Database } = getBuiltin('node:sqlite') as typeof import('node:sqlite');
    this.db = new Database(path.join(dataDir, 'team.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        name TEXT PRIMARY KEY, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY, user TEXT NOT NULL REFERENCES users(name) ON DELETE CASCADE,
        hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created INTEGER NOT NULL, used INTEGER
      );
      CREATE TABLE IF NOT EXISTS collections (
        slug TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL, created_by TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS members (
        collection TEXT NOT NULL REFERENCES collections(slug) ON DELETE CASCADE,
        user TEXT NOT NULL REFERENCES users(name) ON DELETE CASCADE,
        role TEXT NOT NULL, PRIMARY KEY (collection, user)
      );
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, user TEXT NOT NULL,
        action TEXT NOT NULL, collection TEXT, detail TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_collection ON audit(collection, id);
      CREATE TABLE IF NOT EXISTS identities (
        issuer TEXT NOT NULL, subject TEXT NOT NULL,
        user TEXT NOT NULL REFERENCES users(name) ON DELETE CASCADE,
        created INTEGER NOT NULL, PRIMARY KEY (issuer, subject), UNIQUE (issuer, user)
      );
    `);
  }

  close() {
    this.db.close();
  }

  // accounts

  userCount() {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  users(): User[] {
    return (this.db.prepare('SELECT name, admin, created FROM users ORDER BY name').all() as { name: string; admin: number; created: number }[])
      .map(({ name, admin, created }) => ({ name, admin: !!admin, created }));
  }

  user(name: string): User | null {
    const row = this.db.prepare('SELECT name, admin, created FROM users WHERE name = ?').get(name) as { name: string; admin: number; created: number } | undefined;
    return row ? { name: row.name, admin: !!row.admin, created: row.created } : null;
  }

  addUser(name: string, password: string, admin = false) {
    if (!isName(name)) {
      throw new Error('A user name is lowercase letters, digits, dots, dashes and underscores');
    }
    if (password.length < 10) {
      throw new Error('A password needs at least 10 characters');
    }
    if (this.user(name)) {
      throw new Error(`There's already a user named ${name}`);
    }
    this.db.prepare('INSERT INTO users (name, password, admin, created) VALUES (?, ?, ?, ?)').run(name, hashPassword(password), admin ? 1 : 0, Date.now());
  }

  // an account for single sign-on (oidc.ts), with no password until an admin resets one
  addSsoUser(name: string) {
    if (!isName(name)) {
      throw new Error('A user name is lowercase letters, digits, dots, dashes and underscores');
    }
    this.db.prepare('INSERT INTO users (name, password, admin, created) VALUES (?, ?, 0, ?)').run(name, NO_PASSWORD, Date.now());
  }

  // who signed in at a provider, by its subject id
  userOfIdentity(issuer: string, subject: string) {
    const row = this.db.prepare('SELECT user FROM identities WHERE issuer = ? AND subject = ?').get(issuer, subject) as { user: string } | undefined;
    return row ? this.user(row.user) : null;
  }

  identityOf(user: string, issuer: string) {
    const row = this.db.prepare('SELECT subject FROM identities WHERE user = ? AND issuer = ?').get(user, issuer) as { subject: string } | undefined;
    return row?.subject ?? null;
  }

  linkIdentity(issuer: string, subject: string, user: string) {
    this.db.prepare('INSERT INTO identities (issuer, subject, user, created) VALUES (?, ?, ?, ?)').run(issuer, subject, user, Date.now());
  }

  setPassword(name: string, password: string) {
    if (password.length < 10) {
      throw new Error('A password needs at least 10 characters');
    }
    if (!this.db.prepare('UPDATE users SET password = ? WHERE name = ?').run(hashPassword(password), name).changes) {
      throw new Error(`No user named ${name}`);
    }
    // the access tokens made with the old one end with it
    this.db.prepare('DELETE FROM tokens WHERE user = ?').run(name);
  }

  setAdmin(name: string, admin: boolean) {
    if (!admin && this.user(name)?.admin && this.users().filter(user => user.admin).length === 1) {
      throw new Error('The last admin stays an admin');
    }
    if (!this.db.prepare('UPDATE users SET admin = ? WHERE name = ?').run(admin ? 1 : 0, name).changes) {
      throw new Error(`No user named ${name}`);
    }
  }

  removeUser(name: string) {
    if (this.user(name)?.admin && this.users().filter(user => user.admin).length === 1) {
      throw new Error("The last admin can't be removed");
    }
    if (!this.db.prepare('DELETE FROM users WHERE name = ?').run(name).changes) {
      throw new Error(`No user named ${name}`);
    }
  }

  // who a token is, if it's that user's when a name is given: null for one
  // that isn't a token, or has gone unused too long
  userOfToken(secret: string, name?: string): User | null {
    if (!secret.startsWith(TOKEN_PREFIX)) {
      return null;
    }
    this.db.prepare('DELETE FROM tokens WHERE COALESCE(used, created) < ?').run(Date.now() - TOKEN_IDLE_MS);
    const token = this.db.prepare('SELECT id, user FROM tokens WHERE hash = ?').get(sha256(secret)) as { id: string; user: string } | undefined;
    if (!token || (name !== undefined && token.user !== name)) {
      return null;
    }
    this.db.prepare('UPDATE tokens SET used = ? WHERE id = ?').run(Date.now(), token.id);
    return this.user(token.user);
  }

  // who a password is: the user, or null; as slow for a user who isn't there
  async userOfPassword(name: string, password: string): Promise<User | null> {
    const user = this.user(name);
    const row = user ? this.db.prepare('SELECT password FROM users WHERE name = ?').get(name) as { password: string } : null;
    const usable = !!row && row.password !== NO_PASSWORD;
    const right = await checkPassword(password, usable ? row.password : DUMMY_HASH);
    return usable && right ? user : null;
  }

  // who a password or a token is: the user, or null. A token beats a password
  // that happens to look like one.
  async authenticate(name: string, secret: string): Promise<User | null> {
    if (!secret) {
      return null;
    }
    return (secret.startsWith(TOKEN_PREFIX) && this.userOfToken(secret, name)) || this.userOfPassword(name, secret);
  }

  // access tokens: the secret is returned once, and only its hash kept

  addToken(user: string, label: string) {
    const secret = newToken();
    const id = randomBytes(8).toString('hex');
    this.db.prepare('INSERT INTO tokens (id, user, hash, label, created) VALUES (?, ?, ?, ?, ?)').run(id, user, sha256(secret), label.slice(0, 100) || 'token', Date.now());
    return { id, secret };
  }

  tokens(user: string) {
    return this.db.prepare('SELECT id, label, created, used FROM tokens WHERE user = ? ORDER BY created').all(user) as { id: string; label: string; created: number; used: number | null }[];
  }

  removeToken(user: string, id: string) {
    return this.db.prepare('DELETE FROM tokens WHERE id = ? AND user = ?').run(id, user).changes > 0;
  }

  // collections and who may use them

  collection(slug: string): Collection | null {
    const row = this.db.prepare('SELECT slug, name, created, created_by FROM collections WHERE slug = ?').get(slug) as { slug: string; name: string; created: number; created_by: string } | undefined;
    return row ? { slug: row.slug, name: row.name, created: row.created, createdBy: row.created_by } : null;
  }

  addCollection(slug: string, name: string, owner: string) {
    if (!isName(slug)) {
      throw new Error('A collection slug is lowercase letters, digits, dots, dashes and underscores');
    }
    if (this.collection(slug)) {
      throw new Error(`There's already a collection ${slug}`);
    }
    this.db.prepare('INSERT INTO collections (slug, name, created, created_by) VALUES (?, ?, ?, ?)').run(slug, name.slice(0, 200) || slug, Date.now(), owner);
    this.setRole(slug, owner, 'owner');
  }

  removeCollection(slug: string) {
    return this.db.prepare('DELETE FROM collections WHERE slug = ?').run(slug).changes > 0;
  }

  // a user's role on a collection; an admin is an owner of every one
  roleOf(user: User, slug: string): CollectionRole | null {
    if (!this.collection(slug)) {
      return null;
    }
    if (user.admin) {
      return 'owner';
    }
    const row = this.db.prepare('SELECT role FROM members WHERE collection = ? AND user = ?').get(slug, user.name) as { role: CollectionRole } | undefined;
    return row?.role ?? null;
  }

  setRole(slug: string, user: string, role: CollectionRole) {
    if (!ROLES.includes(role)) {
      throw new Error(`A role is one of ${ROLES.join(', ')}`);
    }
    if (!this.user(user)) {
      throw new Error(`No user named ${user}`);
    }
    const owners = this.members(slug).filter(member => member.role === 'owner');
    if (role !== 'owner' && owners.length === 1 && owners[0].user === user) {
      throw new Error('The last owner stays: make someone else an owner first');
    }
    this.db.prepare('INSERT INTO members (collection, user, role) VALUES (?, ?, ?) ON CONFLICT (collection, user) DO UPDATE SET role = excluded.role').run(slug, user, role);
  }

  removeMember(slug: string, user: string) {
    const owners = this.members(slug).filter(member => member.role === 'owner');
    if (owners.length === 1 && owners[0].user === user) {
      throw new Error('The last owner stays: make someone else an owner first');
    }
    return this.db.prepare('DELETE FROM members WHERE collection = ? AND user = ?').run(slug, user).changes > 0;
  }

  members(slug: string) {
    return this.db.prepare('SELECT user, role FROM members WHERE collection = ? ORDER BY user').all(slug) as { user: string; role: CollectionRole }[];
  }

  // the collections a user can see, with their role on each
  collectionsFor(user: User): (Collection & { role: CollectionRole })[] {
    const rows = (user.admin
      ? this.db.prepare("SELECT slug, name, created, created_by, 'owner' AS role FROM collections ORDER BY name").all()
      : this.db.prepare('SELECT c.slug, c.name, c.created, c.created_by, m.role FROM collections c JOIN members m ON m.collection = c.slug WHERE m.user = ? ORDER BY c.name').all(user.name)
    ) as { slug: string; name: string; created: number; created_by: string; role: CollectionRole }[];
    return rows.map(row => ({ slug: row.slug, name: row.name, created: row.created, createdBy: row.created_by, role: row.role }));
  }

  // the audit log

  log(user: string, action: string, collection: string | null, detail: Record<string, unknown> = {}) {
    this.db.prepare('INSERT INTO audit (at, user, action, collection, detail) VALUES (?, ?, ?, ?, ?)').run(Date.now(), user, action, collection, JSON.stringify(detail));
  }

  // newest first; before: an id, for the next page. A collection's is its
  // own, not also that of a removed one that had its slug.
  audit({ collection, before, limit = 100 }: { collection?: string; before?: number; limit?: number } = {}): AuditEntry[] {
    const since = collection ? this.collection(collection)?.created : undefined;
    const clauses = [collection ? 'collection = ?' : '', since !== undefined ? 'at >= ?' : '', before ? 'id < ?' : ''].filter(Boolean);
    const args = [collection, since, before].filter(value => value !== undefined) as (string | number)[];
    const rows = this.db.prepare(`SELECT id, at, user, action, collection, detail FROM audit ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
      .all(...args, Math.min(Math.max(limit, 1), 500)) as { id: number; at: number; user: string; action: string; collection: string | null; detail: string }[];
    return rows.map(row => ({ ...row, detail: JSON.parse(row.detail) }));
  }
}
