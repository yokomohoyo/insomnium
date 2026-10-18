// insomnium-server: Insomnium's MCP tools without the app, for a container
// deployed next to the APIs an agent should test; `run`, the collection
// runner for CI; and `mock`, a collection's mock server. See
// packages/insomnium-server.
import fs from 'node:fs';

import { loadMockRoutes, mockPathOf } from '../mock/mock-routes';
import { startMockServer } from '../mock/mock-server';
import { brokenThresholds } from '../network/load-stats';
import { runLoadTest } from '../network/load-test';
import { jsonReport, junitReport } from '../network/run-files';
import { runRequests } from '../network/runner';
import { parseConfig, ServerConfig, USAGE } from './config';
import { formatLoadSummary, LOAD_USAGE, LoadConfig, parseLoadConfig } from './load-test';
import { MOCK_USAGE, MockConfig, parseMockConfig } from './mock';
import { formatResult, formatSummary } from './report';
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

// 0 when the thresholds held, 1 when one broke, 2 when the test couldn't start
async function load(argv: string[]) {
  if (argv.includes('--help')) {
    console.log(LOAD_USAGE);
    return 0;
  }
  let config: LoadConfig;
  try {
    config = parseLoadConfig(argv, process.env);
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${LOAD_USAGE}`);
    return 2;
  }

  console.log = console.info = console.debug = () => {};
  let prepared;
  try {
    const workspaces = await loadWorkspaces(config);
    const requests = await selectRequests(workspaces, config.folder);
    if (!requests.length) {
      throw new Error(`No HTTP requests to load test${config.folder ? ` in '${config.folder}'` : ''}`);
    }
    prepared = { requests, name: workspaces.map(workspace => workspace.name).join(', ') };
  } catch (err) {
    console.error(`[load] ${(err as Error).message}`);
    return 2;
  }

  const { requests, name } = prepared;
  print(`[load] ${name}: ${requests.length} ${requests.length === 1 ? 'request' : 'requests'}, ${config.virtualUsers} ${config.virtualUsers === 1 ? 'user' : 'users'} for ${config.durationMs / 1000} s`);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let summary;
  try {
    summary = await runLoadTest(requests, {
      virtualUsers: config.virtualUsers,
      durationMs: config.durationMs,
      rampUpMs: config.rampUpMs,
      thinkTimeMs: config.thinkTimeMs,
      signal: controller.signal,
      onProgress: progress => process.stderr.write(`\r[load] ${progress.requests} sent · ${progress.throughput}/s · ${progress.failed} failed · p95 ${progress.latency.p95} ms   `),
    });
  } catch (err) {
    console.error(`\n[load] ${(err as Error).message}`);
    return 2;
  }
  process.stderr.write('\n');
  print(`\n${formatLoadSummary(summary)}`);
  const broken = brokenThresholds(summary, config.thresholds);
  if (config.json) {
    await fs.promises.writeFile(config.json, JSON.stringify({ name, ...summary, thresholds: config.thresholds, broken }, null, 2));
  }
  for (const reason of broken) {
    print(`✗ ${reason}`);
  }
  return broken.length ? 1 : 0;
}

async function mock(argv: string[]) {
  if (argv.includes('--help')) {
    console.log(MOCK_USAGE);
    return;
  }
  let config: MockConfig;
  try {
    config = parseMockConfig(argv, process.env);
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${MOCK_USAGE}`);
    process.exit(2);
  }

  // a mock answers; it never sends (a {% response %} tag in an example would)
  const log = console.log;
  console.log = console.info = console.debug = () => {};
  const workspaces = await loadWorkspaces({ collections: config.collections, repos: config.repos, branch: config.branch, gitToken: config.gitToken, gitUsername: config.gitUsername, variables: {}, validateSSL: true, allowedHosts: [], allowedEnvironmentVariables: '' });
  for (const workspace of workspaces) {
    for (const { request, examples } of await loadMockRoutes(workspace)) {
      log(`[mock] ${request.method} ${mockPathOf(request.url)}  ${request.name} (${examples.length} ${examples.length === 1 ? 'example' : 'examples'})`);
    }
  }
  const server = await startMockServer({
    workspaceIds: workspaces.map(workspace => workspace._id),
    port: config.port,
    host: config.host,
    onRequest: entry => log(`[mock] ${entry.method} ${entry.path} ${entry.status}  ${entry.exampleName ? `${entry.requestName} · ${entry.exampleName}` : entry.note || ''}`.trimEnd()),
  });
  log(`[mock] answering at ${server.url}`);

  const stop = () => server.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
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
  if (config.repos.length && config.pullInterval > 0) {
    console.log(`[server] updating ${config.repos.length === 1 ? 'the repository' : `${config.repos.length} repositories`} every ${config.pullInterval} s`);
  }

  const stop = () => http.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'run') {
    process.exit(await run(argv.slice(1)));
  }
  if (argv[0] === 'mock') {
    return mock(argv.slice(1));
  }
  if (argv[0] === 'load') {
    process.exit(await load(argv.slice(1)));
  }
  await serve(argv);
}

main().catch(err => {
  console.error('[server] failed:', err);
  process.exit(1);
});
