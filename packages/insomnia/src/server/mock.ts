// `insomnium-server mock`: a collection's local mock server without the app,
// answering with its requests' examples (mock/mock-server.ts).
import { emptySources, requireSources, Sources, SOURCES_USAGE, takeSourceOption } from './sources';

export const MOCK_USAGE = `Usage: insomnium-server mock (--collection <file> | --repo <url or directory>) [--port <n>] [--host <address>]

Answers as the collection's requests would, with their examples (saved
responses). A request matches by method and path, in which :params and
{{ variables }} match anything. The headers x-mock-response-name or
x-mock-response-code choose an example; otherwise the first 2xx one answers.

${SOURCES_USAGE}
  --port        the port to listen on (default 4040; INSOMNIUM_MOCK_PORT)
  --host        the address to listen on (default 127.0.0.1; INSOMNIUM_MOCK_HOST);
                0.0.0.0 in a container`;

export interface MockConfig extends Sources {
  port: number;
  host: string;
}

export const parseMockConfig = (argv: string[], env: Record<string, string | undefined>): MockConfig => {
  const config: MockConfig = {
    ...emptySources(env),
    port: Number(env.INSOMNIUM_MOCK_PORT || 4040),
    host: env.INSOMNIUM_MOCK_HOST || '127.0.0.1',
  };
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    const value = argv[i + 1];
    if (!['--collection', '--repo', '--branch', '--port', '--host'].includes(option)) {
      throw new Error(`Unknown option ${option}`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${option} needs a value`);
    }
    i++;
    if (takeSourceOption(config, option, () => value)) {
      continue;
    }
    if (option === '--port') {
      config.port = Number(value);
    } else {
      config.host = value;
    }
  }
  requireSources(config);
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error('--port must be a port number');
  }
  return config;
};
