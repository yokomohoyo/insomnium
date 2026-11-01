// `insomnium-server team`: a server a team runs on its own network (a NAS, a
// home server) to share collections with Git Sync. It serves each collection
// as a Git repository, with accounts, per-collection roles and an audit log.
// See packages/insomnium-server/README.md.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

import { parseTls, TLS_USAGE } from '../tls';
import { parseOidcConfig } from './oidc';
import { startTeamServer, type TeamConfig } from './server';
import { newPassword, TeamStore } from './store';

export const TEAM_USAGE = `Usage: insomnium-server team [--data <dir>] [--host <address>] [--port <port>] [--public-url <url>]
       insomnium-server team user list | add <name> [--admin] | reset-password <name> | admin <name> on|off | remove <name>
       insomnium-server team token <name> [label]

Shares collections with Git Sync: each is a Git repository at <url>/git/<slug>.git,
which members clone and push with their user name and an access token.

  --data        where the accounts and repositories are kept (INSOMNIUM_TEAM_DATA, default /data)
  --host        the address to listen on (INSOMNIUM_HOST, default 0.0.0.0)
  --port        the port (INSOMNIUM_PORT, default 8080)
  --public-url  how members reach it, for clone URLs, such as https://nas.example.com:8443
                (INSOMNIUM_TEAM_URL; otherwise from each request)

The first start makes an admin: INSOMNIUM_TEAM_ADMIN names it (default admin), and
INSOMNIUM_TEAM_ADMIN_PASSWORD sets its password; without one, a password is made
and printed once. Serve it over HTTPS, as sign-in sends the password or token: put
a reverse proxy in front, or give it a certificate:
${TLS_USAGE}

Single sign-on with OpenID Connect (Authentik, Keycloak, Entra ID, Google, ...):
register a confidential client with the redirect URL <url>/auth/oidc/callback, and set
  INSOMNIUM_TEAM_OIDC_ISSUER          the provider's issuer URL
  INSOMNIUM_TEAM_OIDC_CLIENT_ID       the client's id
  INSOMNIUM_TEAM_OIDC_CLIENT_SECRET   its secret
  INSOMNIUM_TEAM_OIDC_USERNAME_CLAIM  the claim naming the account (default preferred_username)
  INSOMNIUM_TEAM_OIDC_EMAIL_DOMAINS   with the email claim: the domains that may sign in (example.com,…)
  INSOMNIUM_TEAM_OIDC_CREATE_USERS    true: make an account for someone who has none
  INSOMNIUM_TEAM_OIDC_NAME            the provider's name, for the sign-in button`;

export interface TeamCliConfig extends TeamConfig {
  command: string[];
}

export function parseTeamConfig(argv: string[], env: NodeJS.ProcessEnv): TeamCliConfig {
  const config: TeamCliConfig = {
    dataDir: env.INSOMNIUM_TEAM_DATA || '/data',
    host: env.INSOMNIUM_HOST || '0.0.0.0',
    port: Number(env.INSOMNIUM_PORT || 8080),
    publicUrl: env.INSOMNIUM_TEAM_URL || undefined,
    oidc: parseOidcConfig(env),
    tls: parseTls(env),
    command: [],
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined) {
        throw new Error(`${arg} needs a value`);
      }
      return next;
    };
    if (arg === '--data') {
      config.dataDir = value();
    } else if (arg === '--host') {
      config.host = value();
    } else if (arg === '--port') {
      config.port = Number(value());
    } else if (arg === '--public-url') {
      config.publicUrl = value();
    } else {
      config.command.push(arg);
    }
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('--port is a number from 1 to 65535');
  }
  if (config.publicUrl && !/^https?:\/\/[^/]+/.test(config.publicUrl)) {
    throw new Error('--public-url is an http(s) URL, such as https://nas.example.com');
  }
  return config;
}

// The first admin, on a first start
export function ensureAdmin(store: TeamStore, env: NodeJS.ProcessEnv, print: (text: string) => void) {
  if (store.userCount() > 0) {
    return;
  }
  const name = env.INSOMNIUM_TEAM_ADMIN || 'admin';
  const given = env.INSOMNIUM_TEAM_ADMIN_PASSWORD;
  const password = given || newPassword();
  store.addUser(name, password, true);
  store.log(name, 'user.create', null, { user: name, admin: true, firstStart: true });
  print(given
    ? `[team] made the admin ${name}, with the password INSOMNIUM_TEAM_ADMIN_PASSWORD gives`
    : `[team] made the admin ${name}, with the password ${password}\n[team] it is shown only this once: sign in and change it`);
}

// the admin commands, run where the data is (docker exec … insomnium-server team user add kim)
export function runAdminCommand(store: TeamStore, command: string[], print: (text: string) => void) {
  const [area, action, name, extra] = command;
  if (area === 'user') {
    if (action === 'list') {
      for (const user of store.users()) {
        print(`${user.name}${user.admin ? ' (admin)' : ''}`);
      }
      return;
    }
    if (!name) {
      throw new Error(`team user ${action || '…'} needs a user name`);
    }
    if (action === 'add') {
      const password = newPassword();
      store.addUser(name, password, command.includes('--admin'));
      store.log('cli', 'user.create', null, { user: name, admin: command.includes('--admin') });
      print(`${name}'s password: ${password}`);
      return;
    }
    if (action === 'reset-password') {
      const password = newPassword();
      store.setPassword(name, password);
      store.log('cli', 'user.update', null, { user: name, resetPassword: true });
      print(`${name}'s new password: ${password}`);
      return;
    }
    if (action === 'admin' && (extra === 'on' || extra === 'off')) {
      store.setAdmin(name, extra === 'on');
      store.log('cli', 'user.update', null, { user: name, admin: extra === 'on' });
      print(`${name} is ${extra === 'on' ? 'now' : 'no longer'} an admin`);
      return;
    }
    if (action === 'remove') {
      store.removeUser(name);
      store.log('cli', 'user.remove', null, { user: name });
      print(`removed ${name}`);
      return;
    }
  }
  if (area === 'token' && action) {
    if (!store.user(action)) {
      throw new Error(`No user named ${action}`);
    }
    const token = store.addToken(action, name || 'token');
    store.log('cli', 'token.create', null, { user: action, id: token.id });
    print(token.secret);
    return;
  }
  throw new Error(`Not a team command: ${command.join(' ')}`);
}

export async function team(argv: string[], env: NodeJS.ProcessEnv) {
  if (argv.includes('--help')) {
    console.log(TEAM_USAGE);
    return 0;
  }
  let config: TeamCliConfig;
  try {
    config = parseTeamConfig(argv, env);
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${TEAM_USAGE}`);
    return 2;
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const print = (text: string) => process.stdout.write(`${text}\n`);

  if (config.command.length && config.command[0] !== 'serve') {
    const store = new TeamStore(config.dataDir);
    try {
      runAdminCommand(store, config.command, print);
      return 0;
    } catch (err) {
      console.error(`${(err as Error).message}\n\n${TEAM_USAGE}`);
      return 2;
    } finally {
      store.close();
    }
  }

  const gitVersion = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (gitVersion.status !== 0) {
    console.error('[team] git is needed (the image has it): install git, or use the insomnium-server image');
    return 2;
  }
  const { server, store } = await startTeamServer(config);
  ensureAdmin(store, env, print);
  print(`[team] serving ${store.collectionsFor({ name: '', admin: true, created: 0 }).length} collections for ${store.userCount()} users at http://${config.host}:${config.port}${config.publicUrl ? ` (${config.publicUrl})` : ''}, from ${config.dataDir}`);
  const stop = () => server.close(() => {
    store.close();
    process.exit(0);
  });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return new Promise<number>(() => {});
}
