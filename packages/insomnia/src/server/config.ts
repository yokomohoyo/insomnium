import { emptySources, GIT_USAGE, requireSources, Sources, SOURCES_USAGE, takeSourceOption } from './sources';
import { parseTls, type TlsFiles, TLS_USAGE } from './tls';

export interface ServerConfig extends Sources {
  environment?: string;
  // seconds between updates of the repositories; 0 for none
  pullInterval: number;
  host: string;
  port: number;
  token: string;
  allowedHosts: string[];
  variables: Record<string, string>;
  validateSSL: boolean;
  allowedEnvironmentVariables: string;
  allowedSecrets: string;
  // HTTPS from these files, when set
  tls?: TlsFiles;
}

export const USAGE = `Usage: insomnium-server (--collection <file> | --repo <url or directory>) ... [--env <name>] [--host <address>] [--port <port>]
       insomnium-server run --collection <file> ...   (the collection runner; run --help)

${SOURCES_USAGE}
  --pull-interval  seconds between updates of the repositories (INSOMNIUM_PULL_INTERVAL,
                default 300); 0 for none
  --env         the sub environment to send with, by name
  --host        the address to listen on (INSOMNIUM_HOST, default 127.0.0.1)
  --port        the port to listen on (INSOMNIUM_PORT, default 8080)

Environment:
  INSOMNIUM_MCP_TOKEN      required, 32+ characters; clients send Authorization: Bearer <token>
  INSOMNIUM_ALLOWED_HOSTS  required, comma-separated hosts requests may go to:
                           api.example.com, *.internal.example.com, 10.0.0.5, or * for any
  INSOMNIUM_VAR_<name>     sets <name> in the environment, for secrets
  INSOMNIUM_VALIDATE_SSL   false to skip certificate validation
  INSOMNIUM_ALLOWED_ENV    comma-separated environment variables templates may read with
                           {% env 'NAME' %}: names, or prefixes ending in *; none by default
  INSOMNIUM_ALLOWED_SECRETS secret-manager secrets templates may read (vault:<path>, op://…,
                           aws:<id>, gcp:projects/…, azure:<vault>/<name>), or prefixes
                           ending in *; none by default
${TLS_USAGE}
${GIT_USAGE}`;

const VAR_PREFIX = 'INSOMNIUM_VAR_';

// the longest a timer waits, 2^31 - 1 ms, in whole seconds (about 24 days):
// setInterval runs one that's longer at once, and again every millisecond
export const MAX_PULL_INTERVAL = 2147483;

export const parseConfig = (argv: string[], env: Record<string, string | undefined>): ServerConfig => {
  const sources = emptySources(env);
  // (set but empty is unset)
  let pullInterval = Number(env.INSOMNIUM_PULL_INTERVAL || 300);
  let environment: string | undefined;
  let host = env.INSOMNIUM_HOST || '127.0.0.1';
  let port = Number(env.INSOMNIUM_PORT || 8080);

  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${option} needs a value`);
      }
      return next;
    };
    if (takeSourceOption(sources, option, value)) {
      continue;
    }
    switch (option) {
      case '--pull-interval':
        pullInterval = Number(value());
        break;
      case '--env':
        environment = value();
        break;
      case '--host':
        host = value();
        break;
      case '--port':
        port = Number(value());
        break;
      default:
        throw new Error(`Unknown option ${option}`);
    }
  }

  requireSources(sources);
  if (!Number.isInteger(pullInterval) || pullInterval < 0 || pullInterval > MAX_PULL_INTERVAL) {
    throw new Error(`--pull-interval must be a whole number of seconds, up to ${MAX_PULL_INTERVAL} (0 for none)`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('The port must be a number from 1 to 65535');
  }
  const token = env.INSOMNIUM_MCP_TOKEN || '';
  if (token.length < 32) {
    throw new Error('Set INSOMNIUM_MCP_TOKEN to a random string of at least 32 characters, for example from: openssl rand -base64 32');
  }
  const allowedHosts = (env.INSOMNIUM_ALLOWED_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  if (!allowedHosts.length) {
    throw new Error('Set INSOMNIUM_ALLOWED_HOSTS to the hosts requests may go to (comma-separated; * allows any)');
  }
  const variables = Object.fromEntries(Object.entries(env)
    .filter((entry): entry is [string, string] => entry[0].startsWith(VAR_PREFIX) && entry[0].length > VAR_PREFIX.length && entry[1] !== undefined)
    .map(([name, value]) => [name.slice(VAR_PREFIX.length), value]));

  return {
    ...sources,
    pullInterval,
    environment,
    host,
    port,
    token,
    allowedHosts,
    variables,
    validateSSL: env.INSOMNIUM_VALIDATE_SSL !== 'false',
    allowedEnvironmentVariables: env.INSOMNIUM_ALLOWED_ENV || '',
    allowedSecrets: env.INSOMNIUM_ALLOWED_SECRETS || '',
    tls: parseTls(env),
  };
};
