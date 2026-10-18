// insomnium-server: Insomnium's MCP tools without the app, for a container
// deployed next to the APIs an agent should test; and `run`, the collection
// runner for CI. See packages/insomnium-server.
import fs from 'node:fs';

import { runRequests } from '../network/runner';
import { parseConfig, ServerConfig, USAGE } from './config';
import { formatResult, formatSummary, jsonReport, junitReport } from './report';
import { parseRunConfig, readDataFile, RUN_USAGE, RunConfig, selectRequests } from './run';
import { loadWorkspaces, startServer } from './server';

const print = (text: string) => process.stdout.write(text + '\n');

// 0 when everything passed, 1 when a request or assertion failed, 2 when the
// run couldn't start
async function run(argv: string[]) {
  if (argv.includes('--help')) {
    console.log(RUN_USAGE);
    return 0;
  }
  let config: RunConfig;
  try {
    config = parseRunConfig(argv, process.env);
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${RUN_USAGE}`);
    return 2;
  }

  // the send path logs as it goes, for the app; a run prints only its results
  console.log = console.info = console.debug = () => {};
  let prepared;
  try {
    const data = config.data ? await readDataFile(config.data) : undefined;
    const workspaces = await loadWorkspaces(config);
    const requests = await selectRequests(workspaces, config.folder);
    if (!requests.length) {
      throw new Error(`No HTTP requests to run${config.folder ? ` in '${config.folder}'` : ''}`);
    }
    prepared = { data, requests, name: workspaces.map(workspace => workspace.name).join(', ') };
  } catch (err) {
    console.error(`[run] ${(err as Error).message}`);
    return 2;
  }

  const { data, requests, name } = prepared;
  const iterations = Math.max(1, config.iterations ?? (data?.length || 1));
  print(`[run] ${name}: ${requests.length} ${requests.length === 1 ? 'request' : 'requests'}${iterations > 1 ? `, ${iterations} iterations` : ''}`);
  let iteration = 0;
  const summary = await runRequests(requests, {
    iterations,
    data,
    delay: config.delay,
    bail: config.bail,
    onResult: result => {
      if (iterations > 1 && result.iteration !== iteration) {
        iteration = result.iteration;
        print(`Iteration ${iteration}`);
      }
      print(formatResult(result));
    },
  });
  print(`\n${formatSummary(summary)}`);
  if (config.junit) {
    await fs.promises.writeFile(config.junit, junitReport(summary, name));
  }
  if (config.json) {
    await fs.promises.writeFile(config.json, jsonReport(summary, name));
  }
  return summary.requests.failed ? 1 : 0;
}

async function serve(argv: string[]) {
  if (argv.includes('--help')) {
    console.log(USAGE);
    return;
  }
  let config: ServerConfig;
  try {
    config = parseConfig(argv, process.env);
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

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'run') {
    process.exit(await run(argv.slice(1)));
  }
  await serve(argv);
}

main().catch(err => {
  console.error('[server] failed:', err);
  process.exit(1);
});
