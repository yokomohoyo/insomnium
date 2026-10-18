export interface ServerConfig {
  collections: string[];
  environment?: string;
  host: string;
  port: number;
  token: string;
  allowedHosts: string[];
  variables: Record<string, string>;
  validateSSL: boolean;
  allowedEnvironmentVariables: string;
}

export const USAGE = `Usage: insomnium-server --collection <file> [--collection <file> ...] [--env <name>] [--host <address>] [--port <port>]
       insomnium-server run --collection <file> ...   (the collection runner; run --help)

  --collection  an Insomnium or Insomnia (v4 or v5) export, or a Postman collection
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
                           {% env 'NAME' %}: names, or prefixes ending in *; none by default`;

const VAR_PREFIX = 'INSOMNIUM_VAR_';

export const parseConfig = (argv: string[], env: Record<string, string | undefined>): ServerConfig => {
  const collections: string[] = [];
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
    switch (option) {
      case '--collection':
        collections.push(value());
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

  if (!collections.length) {
    throw new Error('Give at least one --collection');
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
    collections,
    environment,
    host,
    port,
    token,
    allowedHosts,
    variables,
    validateSSL: env.INSOMNIUM_VALIDATE_SSL !== 'false',
    allowedEnvironmentVariables: env.INSOMNIUM_ALLOWED_ENV || '',
  };
};
