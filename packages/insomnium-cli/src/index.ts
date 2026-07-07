#!/usr/bin/env node
// insomnium: a CLI for driving a running Insomnium app over its loopback MCP
// server. Commands map 1:1 to MCP tools, so anything the CLI mutates refreshes
// the app UI live (the app broadcasts db changes to its windows). Designed for
// both humans and LLM agents — `--json` emits structured output, and the
// tools/describe/call verbs mirror MCP's introspection surface.

import http from 'node:http';

import { CliError, readDiscovery, withClient } from './connect.js';

const VERSION = '1.0.0';

const HELP = `insomnium — drive a running Insomnium app over MCP

Usage: insomnium <command> [options]

Commands:
  tools                       List available tools (name + description)
  describe <tool>             Show a tool's input JSON schema
  call <tool> [args]          Invoke a tool and print its result
  status                      Show connection status to the running app
  help                        Show this help

Call arguments:
  --args '<json>'             Tool arguments as a JSON object
  --arg key=value             Single argument (repeatable); values are parsed as
                              JSON when possible, else treated as a string

Global options:
  --json                      Emit raw JSON instead of human-readable text
  -h, --help                  Show help
  -v, --version               Show version

Examples:
  insomnium tools --json
  insomnium describe send_http_request
  insomnium call list_workspaces
  insomnium call send_http_request --arg requestId=req_123
  insomnium call update_request --args '{"requestId":"req_123","name":"New"}'`;

interface Parsed {
  positional: string[];
  json: boolean;
  argsJson?: string;
  argPairs: string[];
  help: boolean;
  version: boolean;
}

function parse(argv: string[]): Parsed {
  const out: Parsed = { positional: [], json: false, argPairs: [], help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-v' || a === '--version') out.version = true;
    else if (a === '--args') out.argsJson = argv[++i];
    else if (a === '--arg') out.argPairs.push(argv[++i]);
    else if (a.startsWith('-')) throw new CliError(`unknown option: ${a}`);
    else out.positional.push(a);
  }
  return out;
}

// Parse a --arg value as JSON when possible (numbers, booleans, null, objects),
// otherwise keep it as a plain string.
function coerce(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function buildArgs(p: Parsed): Record<string, unknown> {
  let args: Record<string, unknown> = {};
  if (p.argsJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(p.argsJson);
    } catch {
      throw new CliError('--args must be a valid JSON object');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new CliError('--args must be a JSON object');
    }
    args = parsed as Record<string, unknown>;
  }
  for (const pair of p.argPairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) throw new CliError(`--arg must be key=value, got: ${pair}`);
    args[pair.slice(0, eq)] = coerce(pair.slice(eq + 1));
  }
  return args;
}

function out(text: string): void {
  process.stdout.write(text + '\n');
}

async function cmdTools(json: boolean): Promise<void> {
  const { tools } = await withClient(c => c.listTools());
  if (json) {
    out(JSON.stringify(tools, null, 2));
    return;
  }
  if (!tools.length) {
    out('(no tools exposed)');
    return;
  }
  const width = Math.max(...tools.map(t => t.name.length));
  for (const t of tools) {
    out(`${t.name.padEnd(width)}  ${t.description ?? ''}`.trimEnd());
  }
}

async function cmdDescribe(name: string, json: boolean): Promise<void> {
  const { tools } = await withClient(c => c.listTools());
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new CliError(`unknown tool: ${name} (run \`insomnium tools\`)`);
  if (json) {
    out(JSON.stringify(tool, null, 2));
    return;
  }
  out(`${tool.name}\n${tool.description ?? ''}\n\nInput schema:`);
  out(JSON.stringify(tool.inputSchema ?? {}, null, 2));
}

async function cmdCall(name: string, p: Parsed): Promise<void> {
  const args = buildArgs(p);
  const result = await withClient(c => c.callTool({ name, arguments: args }));
  if (p.json) {
    out(JSON.stringify(result, null, 2));
  } else {
    const content = Array.isArray(result.content) ? result.content : [];
    for (const block of content) {
      if (block?.type === 'text') out(String(block.text));
      else out(JSON.stringify(block));
    }
  }
  // Surface tool-level failures as a non-zero exit so scripts/agents can branch.
  if (result.isError) process.exitCode = 2;
}

// Host is pinned to loopback; `port` is validated (bounded integer) in readDiscovery.
function checkHealth(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function cmdStatus(json: boolean): Promise<void> {
  const disc = await readDiscovery();
  const url = disc.url ?? `http://127.0.0.1:${disc.port}/sse`;
  const healthy = await checkHealth(disc.port);
  if (json) {
    out(JSON.stringify({ port: disc.port, url, healthy }, null, 2));
    return;
  }
  out(`port:    ${disc.port}`);
  out(`url:     ${url}`);
  out(`healthy: ${healthy ? 'yes' : 'no (is the app running?)'}`);
}

async function main(argv: string[]): Promise<void> {
  const p = parse(argv.slice(2));
  if (p.version) {
    out(VERSION);
    return;
  }
  const cmd = p.positional[0];
  if (p.help || !cmd || cmd === 'help') {
    out(HELP);
    return;
  }
  switch (cmd) {
    case 'tools':
      return cmdTools(p.json);
    case 'describe': {
      const name = p.positional[1];
      if (!name) throw new CliError('describe requires a tool name');
      return cmdDescribe(name, p.json);
    }
    case 'call': {
      const name = p.positional[1];
      if (!name) throw new CliError('call requires a tool name');
      return cmdCall(name, p);
    }
    case 'status':
      return cmdStatus(p.json);
    default:
      throw new CliError(`unknown command: ${cmd} (run \`insomnium help\`)`);
  }
}

main(process.argv).catch(err => {
  const msg = err instanceof CliError ? err.message : String(err);
  process.stderr.write(`insomnium: ${msg}\n`);
  process.exit(1);
});
