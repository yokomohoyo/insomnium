// insomnium-server: Insomnium's MCP tools without the app, for a container
// deployed next to the APIs an agent should test. See packages/insomnium-server.
import { parseConfig, ServerConfig, USAGE } from './config';
import { startServer } from './server';

async function main() {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
    return;
  }
  let config: ServerConfig;
  try {
    config = parseConfig(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }

  const { http, workspaces } = await startServer(config);
  for (const workspace of workspaces) {
    console.log(`[server] loaded ${workspace.name}`);
  }
  console.log(`[server] MCP at http://${config.host}:${config.port}/mcp, sending to ${config.allowedHosts.join(', ')}`);

  const stop = () => http.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch(err => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
