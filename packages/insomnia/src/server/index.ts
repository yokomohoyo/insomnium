// insomnium-server: Insomnium's MCP tools without the app, for a container
// deployed next to the APIs an agent should test; `run`, the collection
// runner for CI; `security`, its security checks; and `mock`, a collection's
// mock server. See
// packages/insomnium-server.
import fs from 'node:fs';

import { version } from '../../package.json';
import { chooseFuzz, fuzzPlanSize } from '../common/fuzz';
import { ignoredRules } from '../common/security-rules';
import { loadMockRoutes, mockPathOf } from '../mock/mock-routes';
import { startMockServer } from '../mock/mock-server';
import * as models from '../models';
import { fuzzCsv, fuzzJson } from '../network/fuzz-report';
import { FUZZ_MAX_ATTEMPTS, listFuzzPoints, runFuzz } from '../network/fuzz-run';
import { loadCsvReport, loadHtmlReport, loadJsonReport } from '../network/load-report';
import { brokenThresholds } from '../network/load-stats';
import { runLoadTest } from '../network/load-test';
import { compareRuns, parseBaseline } from '../network/run-compare';
import { csvReport, htmlReport, jsonReport, junitReport, resultName } from '../network/run-files';
import { requestRunStats } from '../network/run-stats';
import { runRequests } from '../network/runner';
import { baselineMatcher, readBaseline } from '../network/security-baseline';
import { securityJsonReport, securityMarkdownReport, securitySarifReport } from '../network/security-report';
import { securityHtmlReport } from '../network/security-report-html';
import { runSecurityChecks } from '../network/security-run';
import { parseConfig, type ServerConfig, USAGE } from './config';
import { assertMayFuzz, failsFuzz, findFuzzRequest, formatAttempt, formatFuzzSummary, FUZZ_USAGE, type FuzzConfig, parseFuzzConfig } from './fuzz';
import { formatLoadSummary, LOAD_USAGE, type LoadConfig, parseLoadConfig } from './load-test';
import { MOCK_USAGE, type MockConfig, parseMockConfig } from './mock';
import { formatComparison, formatResult, formatSummary } from './report';
import { parseRunConfig, readDataFile, RUN_USAGE, type RunConfig, selectRequests } from './run';
import { failsRun, findOtherEnvironment, formatInventory, formatItem, formatSecuritySummary, parseSecurityConfig, SECURITY_USAGE, type SecurityConfig } from './security';
import { loadWorkspaces, startServer } from './server';
import { team } from './team';

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
    // read first: a baseline that can't be used stops the run before it starts
    const baseline = config.baseline ? parseBaseline(await fs.promises.readFile(config.baseline, 'utf8')) : undefined;
    const workspaces = await loadWorkspaces(config);
    const requests = await selectRequests(workspaces, config.folder);
    if (!requests.length) {
      throw new Error(`No HTTP requests to run${config.folder ? ` in '${config.folder}'` : ''}`);
    }
    prepared = { data, baseline, requests, name: workspaces.map(workspace => workspace.name).join(', ') };
  } catch (err) {
    console.error(`[run] ${(err as Error).message}`);
    return 2;
  }

  const { data, baseline, requests, name } = prepared;
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
  const comparison = baseline ? compareRuns(requestRunStats(summary.results, resultName), baseline, { maxSlowdown: config.maxSlowdown }) : undefined;
  if (comparison) {
    print(`\n${formatComparison(comparison, config.baseline!)}`);
  }
  if (config.junit) {
    await fs.promises.writeFile(config.junit, junitReport(summary, name));
  }
  if (config.json) {
    await fs.promises.writeFile(config.json, jsonReport(summary, name, comparison));
  }
  if (config.html) {
    await fs.promises.writeFile(config.html, htmlReport(summary, name, undefined, comparison));
  }
  if (config.csv) {
    await fs.promises.writeFile(config.csv, csvReport(summary));
  }
  return summary.requests.failed || comparison?.slower ? 1 : 0;
}

// 0 when nothing as severe as --fail-on was found, 1 when something was, 2
// when the checks couldn't start (the go-ahead not given, for one)
async function security(argv: string[]) {
  if (argv.includes('--help')) {
    console.log(SECURITY_USAGE);
    return 0;
  }
  let config: SecurityConfig;
  try {
    config = parseSecurityConfig(argv, process.env);
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${SECURITY_USAGE}`);
    return 2;
  }

  console.log = console.info = console.debug = () => {};
  let prepared;
  try {
    const workspaces = await loadWorkspaces(config);
    const requests = await selectRequests(workspaces, config.folder);
    if (!requests.length) {
      throw new Error(`No HTTP requests to check${config.folder ? ` in '${config.folder}'` : ''}`);
    }
    const otherEnvironmentId = config.otherEnvironment ? await findOtherEnvironment(workspaces, config.otherEnvironment) : null;
    const lowerEnvironmentId = config.lowerEnvironment ? await findOtherEnvironment(workspaces, config.lowerEnvironment, '--as-lower') : null;
    // the rules the collections themselves ignore, as the app's Security tab does
    const ignoredByCollection = ignoredRules(workspaces.flatMap(workspace => workspace.securityIgnoredRules || []));
    // a design document's spec, to compare its requests with (one document: specs don't add up)
    const [design] = workspaces.length === 1 ? workspaces.filter(workspace => workspace.scope === 'design') : [];
    const spec = design ? (await models.apiSpec.getByParentId(design._id))?.contents || undefined : undefined;
    // (with --folder: the rest of the document's requests cover operations too)
    const covering = spec && config.folder ? await selectRequests(workspaces) : undefined;
    // an earlier run to compare with: one that can't be read stops the run,
    // since passing for an empty one would call every finding new, and passing
    // for none would fail a pipeline on what it had accepted
    let matcher;
    if (config.baseline) {
      try {
        matcher = baselineMatcher(readBaseline(await fs.promises.readFile(config.baseline, 'utf8')));
      } catch (err) {
        throw new Error(`Can't use the baseline ${config.baseline}: ${(err as NodeJS.ErrnoException).code === 'ENOENT' ? 'there is no such file' : (err as Error).message}`);
      }
    }
    prepared = { requests, otherEnvironmentId, lowerEnvironmentId, ignoredByCollection, spec, covering, matcher, name: workspaces.map(workspace => workspace.name).join(', ') };
  } catch (err) {
    console.error(`[security] ${(err as Error).message}`);
    return 2;
  }

  const { requests, otherEnvironmentId, lowerEnvironmentId, ignoredByCollection, spec, covering, matcher, name } = prepared;
  print(`[security] ${name}: ${requests.length} ${requests.length === 1 ? 'request' : 'requests'}, sending to ${config.allowedHosts.includes('*') ? 'any host' : config.allowedHosts.join(', ')}`);
  // said, not just done: a collection's file shouldn't be able to quiet a pipeline unseen
  if (ignoredByCollection.length) {
    print(`[security] ignored by the collection: ${ignoredByCollection.join(', ')}`);
  }
  const summary = await runSecurityChecks(requests, {
    otherEnvironmentId,
    lowerEnvironmentId,
    rateLimitRequests: config.rateLimitRequests,
    ignored: ignoredRules([...ignoredByCollection, ...config.ignore]),
    spec,
    covering,
    onItem: item => {
      matcher?.mark(item);
      print(formatItem(item));
    },
  });
  if (summary.inventory) {
    print(`\n${formatInventory(summary.inventory)}`);
  }
  const baseline = matcher?.result();
  print(`\n${formatSecuritySummary(summary, config.failOn, baseline)}`);
  if (config.markdown) {
    await fs.promises.writeFile(config.markdown, securityMarkdownReport(summary, name, new Date(), baseline));
  }
  if (config.html) {
    await fs.promises.writeFile(config.html, securityHtmlReport(summary, name, new Date(), baseline));
  }
  if (config.json) {
    await fs.promises.writeFile(config.json, securityJsonReport(summary, name, new Date(), baseline));
  }
  if (config.sarif) {
    await fs.promises.writeFile(config.sarif, securitySarifReport(summary, name, version, baseline));
  }
  return failsRun(summary, config.failOn, baseline) ? 1 : 0;
}

// 0 when nothing stood out, 1 when an attempt did or couldn't be sent, 2 when
// the fuzz couldn't start (a go-ahead not given, for one)
async function fuzz(argv: string[]) {
  if (argv.includes('--help')) {
    console.log(FUZZ_USAGE);
    return 0;
  }
  let config: FuzzConfig;
  try {
    config = parseFuzzConfig(argv, process.env);
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${FUZZ_USAGE}`);
    return 2;
  }

  console.log = console.info = console.debug = () => {};
  let prepared;
  try {
    const own = config.payloadFile ? await fs.promises.readFile(config.payloadFile, 'utf8') : '';
    const workspaces = await loadWorkspaces(config);
    const found = findFuzzRequest(await selectRequests(workspaces), config.request!);
    assertMayFuzz(found.request.method, config.mayChangeData);
    const { points, url } = await listFuzzPoints(found.request._id);
    const chosen = chooseFuzz(points, { positions: config.positions, lists: config.lists, payloads: own });
    const total = fuzzPlanSize(chosen.points, chosen.payloads, config.mode);
    const attempts = Math.min(FUZZ_MAX_ATTEMPTS, total);
    if (!attempts) {
      throw new Error('Nothing to try: none of the payloads fit the positions (fields to slip in go only in "Body: a new field", and nothing else goes there)');
    }
    prepared = { found, url, chosen, attempts, total };
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[fuzz] ${message.charAt(0).toUpperCase()}${message.slice(1)}`);
    return 2;
  }

  const { found, url, chosen, attempts, total } = prepared;
  const name = [...found.folders, found.request.name].join(' / ');
  print(`[fuzz] ${name}: ${found.request.method} ${url}`);
  print(`[fuzz] ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}${total > attempts ? ` (the first of ${total}: a run makes ${FUZZ_MAX_ATTEMPTS} at most)` : ''}${config.mode === 'one' ? '' : config.mode === 'together' ? ', each payload in every position at once' : ', every combination of payloads over the positions'}, sending to ${config.allowedHosts.includes('*') ? 'any host' : config.allowedHosts.join(', ')}`);
  print(`[fuzz] positions: ${chosen.points.map(({ label }) => label).join(', ')}`);
  print(`[fuzz] payloads: ${chosen.lists.join(', ')}`);
  let summary;
  try {
    summary = await runFuzz(found.request._id, {
      pointIds: chosen.points.map(({ id }) => id),
      payloads: chosen.payloads,
      mode: config.mode,
      delay: config.delay,
      // only what stood out or couldn't be sent: a run is hundreds of lines otherwise
      onAttempt: attempt => {
        if (attempt.notable || attempt.error) {
          print(formatAttempt(attempt));
        }
      },
    });
  } catch (err) {
    console.error(`[fuzz] The request could not be sent as it is: ${(err as Error).message}`);
    return 1;
  }
  print(`\n${formatFuzzSummary(summary, config.noFail)}`);
  if (config.csv) {
    await fs.promises.writeFile(config.csv, fuzzCsv(summary));
  }
  if (config.json) {
    await fs.promises.writeFile(config.json, fuzzJson(summary, name));
  }
  return failsFuzz(summary, config.noFail) ? 1 : 0;
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
    await fs.promises.writeFile(config.json, loadJsonReport(summary, name, config.thresholds));
  }
  if (config.html) {
    await fs.promises.writeFile(config.html, loadHtmlReport(summary, name, config.thresholds));
  }
  if (config.csv) {
    await fs.promises.writeFile(config.csv, loadCsvReport(summary));
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
  const workspaces = await loadWorkspaces({ collections: config.collections, repos: config.repos, branch: config.branch, gitToken: config.gitToken, gitUsername: config.gitUsername, gitTokenHost: config.gitTokenHost, variables: {}, validateSSL: true, allowedHosts: [], allowedEnvironmentVariables: '' });
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
  if (argv[0] === 'security') {
    process.exit(await security(argv.slice(1)));
  }
  if (argv[0] === 'fuzz') {
    process.exit(await fuzz(argv.slice(1)));
  }
  if (argv[0] === 'mock') {
    return mock(argv.slice(1));
  }
  if (argv[0] === 'load') {
    process.exit(await load(argv.slice(1)));
  }
  // a server for a team's collections (team/index.ts)
  if (argv[0] === 'team') {
    process.exit(await team(argv.slice(1), process.env));
  }
  await serve(argv);
}

main().catch(err => {
  console.error('[server] failed:', err);
  process.exit(1);
});
