// The team server's JSON API, under /api, for the app and for scripts. Every
// call is signed in (Basic with a password or a token, or a Bearer token).
//
//   GET    /api/me                                  who you are
//   GET    /api/collections                         the collections you can use, with your role and clone URL
//   POST   /api/collections {name, slug?}           a new collection, which you own
//   DELETE /api/collections/:slug                   (owner) moved to the data folder's trash
//   GET    /api/collections/:slug/members           (viewer)
//   PUT    /api/collections/:slug/members/:user     (owner) {role: viewer|editor|owner}
//   DELETE /api/collections/:slug/members/:user     (owner)
//   GET    /api/collections/:slug/audit             (owner) ?before=<id>
//   GET    /api/tokens  POST /api/tokens {label}    your access tokens; a new one's secret is shown once
//   DELETE /api/tokens/:id
//   PUT    /api/password {current, password}        your password
//   GET    /api/users  POST /api/users {name, admin?}   (admin) a new user gets a generated password
//   PUT    /api/users/:name {admin?, resetPassword?}    (admin)
//   DELETE /api/users/:name                         (admin)
//   GET    /api/audit                               (admin) everything, ?before=<id>
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

import { initRepo, repoPath } from './git-http';
import { atLeast, type CollectionRole, isName, newPassword, slugOf, type TeamStore, type User } from './store';

const MAX_BODY = 64 * 1024;

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const readJson = (req: http.IncomingMessage) => new Promise<Record<string, any>>((resolve, reject) => {
  let size = 0;
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      reject(new ApiError(413, 'The request body is too big'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (!chunks.length) {
      return resolve({});
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      resolve(body && typeof body === 'object' && !Array.isArray(body) ? body : {});
    } catch {
      reject(new ApiError(400, 'The request body is not JSON'));
    }
  });
  req.on('error', reject);
});

export interface ApiContext {
  store: TeamStore;
  dataDir: string;
  // how clients reach this server, for clone URLs: https://nas.example.com
  publicUrl: (req: http.IncomingMessage) => string;
}

export async function handleApi(context: ApiContext, req: http.IncomingMessage, user: User, pathname: string, search: URLSearchParams): Promise<[number, unknown]> {
  const { store, dataDir } = context;
  const method = req.method || 'GET';
  const parts = pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
  const requireAdmin = () => {
    if (!user.admin) {
      throw new ApiError(403, 'Only an admin can do that');
    }
  };
  const requireRole = (slug: string, needed: CollectionRole) => {
    const role = store.roleOf(user, slug);
    if (!role) {
      throw new ApiError(404, `No collection ${slug}`);
    }
    if (!atLeast(role, needed)) {
      throw new ApiError(403, `That needs the ${needed} role on ${slug}`);
    }
  };
  const cloneUrl = (slug: string) => `${context.publicUrl(req)}/git/${slug}.git`;
  const before = Number(search.get('before')) || undefined;

  const [resource, id, sub, subId] = parts;

  if (resource === 'me' && method === 'GET' && !id) {
    return [200, { name: user.name, admin: user.admin }];
  }

  if (resource === 'collections') {
    if (!id) {
      if (method === 'GET') {
        return [200, store.collectionsFor(user).map(collection => ({ ...collection, cloneUrl: cloneUrl(collection.slug) }))];
      }
      if (method === 'POST') {
        const body = await readJson(req);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) {
          throw new ApiError(400, 'A collection needs a name');
        }
        const slug = typeof body.slug === 'string' && body.slug ? body.slug : slugOf(name);
        if (!isName(slug)) {
          throw new ApiError(400, 'A slug is lowercase letters, digits, dots, dashes and underscores');
        }
        if (store.collection(slug) || fs.existsSync(repoPath(dataDir, slug))) {
          throw new ApiError(409, `There's already a collection ${slug}`);
        }
        initRepo(dataDir, slug);
        store.addCollection(slug, name, user.name);
        store.log(user.name, 'collection.create', slug, { name });
        return [201, { ...store.collection(slug), role: 'owner', cloneUrl: cloneUrl(slug) }];
      }
    } else if (!sub) {
      if (method === 'DELETE') {
        requireRole(id, 'owner');
        // kept, out of the way, rather than deleted: an admin can bring it back
        const trash = path.join(dataDir, 'trash');
        fs.mkdirSync(trash, { recursive: true });
        if (fs.existsSync(repoPath(dataDir, id))) {
          fs.renameSync(repoPath(dataDir, id), path.join(trash, `${id}-${Date.now()}.git`));
        }
        store.removeCollection(id);
        store.log(user.name, 'collection.delete', id);
        return [200, { ok: true }];
      }
    } else if (sub === 'members') {
      if (method === 'GET' && !subId) {
        requireRole(id, 'viewer');
        return [200, store.members(id)];
      }
      if (subId && method === 'PUT') {
        requireRole(id, 'owner');
        const { role } = await readJson(req);
        try {
          store.setRole(id, subId, role);
        } catch (err) {
          throw new ApiError(400, (err as Error).message);
        }
        store.log(user.name, 'member.set', id, { user: subId, role });
        return [200, store.members(id)];
      }
      if (subId && method === 'DELETE') {
        requireRole(id, 'owner');
        try {
          store.removeMember(id, subId);
        } catch (err) {
          throw new ApiError(400, (err as Error).message);
        }
        store.log(user.name, 'member.remove', id, { user: subId });
        return [200, store.members(id)];
      }
    } else if (sub === 'audit' && method === 'GET' && !subId) {
      requireRole(id, 'owner');
      return [200, store.audit({ collection: id, before })];
    }
  }

  if (resource === 'tokens') {
    if (!id && method === 'GET') {
      return [200, store.tokens(user.name)];
    }
    if (!id && method === 'POST') {
      const { label } = await readJson(req);
      const token = store.addToken(user.name, typeof label === 'string' ? label : 'token');
      store.log(user.name, 'token.create', null, { id: token.id, label });
      return [201, token];
    }
    if (id && method === 'DELETE') {
      if (!store.removeToken(user.name, id)) {
        throw new ApiError(404, 'No such token');
      }
      store.log(user.name, 'token.revoke', null, { id });
      return [200, { ok: true }];
    }
  }

  if (resource === 'password' && method === 'PUT' && !id) {
    const { current, password } = await readJson(req);
    if (typeof current !== 'string' || !store.authenticate(user.name, current) || current.startsWith('ist_')) {
      throw new ApiError(403, 'The current password is wrong');
    }
    try {
      store.setPassword(user.name, String(password || ''));
    } catch (err) {
      throw new ApiError(400, (err as Error).message);
    }
    store.log(user.name, 'password.change', null);
    return [200, { ok: true }];
  }

  if (resource === 'users') {
    requireAdmin();
    if (!id && method === 'GET') {
      return [200, store.users()];
    }
    if (!id && method === 'POST') {
      const { name, admin } = await readJson(req);
      const password = newPassword();
      try {
        store.addUser(String(name || ''), password, admin === true);
      } catch (err) {
        throw new ApiError(400, (err as Error).message);
      }
      store.log(user.name, 'user.create', null, { user: name, admin: admin === true });
      return [201, { name, admin: admin === true, password }];
    }
    if (id && method === 'PUT') {
      const body = await readJson(req);
      let password: string | undefined;
      try {
        if (typeof body.admin === 'boolean') {
          store.setAdmin(id, body.admin);
        }
        if (body.resetPassword === true) {
          password = newPassword();
          store.setPassword(id, password);
        }
      } catch (err) {
        throw new ApiError(400, (err as Error).message);
      }
      store.log(user.name, 'user.update', null, { user: id, ...(typeof body.admin === 'boolean' ? { admin: body.admin } : {}), ...(password ? { resetPassword: true } : {}) });
      return [200, { ...store.user(id), ...(password ? { password } : {}) }];
    }
    if (id && method === 'DELETE') {
      if (id === user.name) {
        throw new ApiError(400, "You can't remove yourself");
      }
      try {
        store.removeUser(id);
      } catch (err) {
        throw new ApiError(400, (err as Error).message);
      }
      store.log(user.name, 'user.remove', null, { user: id });
      return [200, { ok: true }];
    }
  }

  if (resource === 'audit' && method === 'GET' && !id) {
    requireAdmin();
    return [200, store.audit({ before })];
  }

  throw new ApiError(404, 'Not found');
}
