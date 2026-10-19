/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { codeRoots, readPluginFile } from '../../../main/plugin-sandbox';
import * as requestContext from '../../context/request';
import * as responseContext from '../../context/response';
import { SandboxBuffer } from '../buffer';
import { loadSandboxedPlugin, moduleOf, PluginSandboxError, SandboxedPlugin, type SandboxPort } from '../client';
import { type Port, startRuntime } from '../runtime';

// a plugin's files, as it's installed: its own code, and its node_modules
function writePlugin(dir: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
}

const PLUGIN = {
  'package.json': JSON.stringify({ name: 'insomnia-plugin-test', main: 'index.js', insomnia: {} }),
  'index.js': `
    const { shout } = require('shout');
    const { encode } = require('./lib/encode');
    module.exports.templateTags = [{
      name: 'basic',
      displayName: args => 'computed, so left behind',
      description: 'basic auth from the store',
      args: [{ displayName: 'User', type: 'string', hide: () => false }],
      async run(context, user) {
        const password = await context.store.getItem('password');
        return encode(user + ':' + password);
      },
    }, {
      name: 'stuck',
      run: () => new Promise(() => {}),
    }];
    module.exports.requestHooks = [context => {
      context.request.setHeader('X-Team', context.request.getEnvironmentVariable('team'));
    }];
    module.exports.responseHooks = [context => {
      context.response.setBody(Buffer.from(shout(context.response.getBody().toString())));
    }];
    module.exports.requestActions = [{
      label: 'Say hello',
      icon: 'fa-hand',
      action: async (context, data) => { await context.app.alert('Hello', data.request.name); return 'done'; },
    }];
    module.exports.themes = [{ name: 'test-theme', displayName: 'Test', theme: { background: { default: '#000' } } }];
  `,
  'lib/encode.js': 'exports.encode = text => Buffer.from(text).toString("base64");',
  'node_modules/shout/package.json': JSON.stringify({ name: 'shout', main: 'lib/main.js' }),
  'node_modules/shout/lib/main.js': 'exports.shout = text => text.toUpperCase() + "!";',
};

describe('a plugin in its sandbox', () => {
  let dir: string;
  let ports: MessagePort[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-plugin-'));
    ports = [];
  });
  afterEach(() => {
    ports.forEach(port => port.close());
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // the sandbox's runtime and the window's client, on the two ends of a channel
  const load = async (files: Record<string, string>, timeout?: number) => {
    writePlugin(dir, files);
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    startRuntime(port1 as unknown as Port, { read: file => readPluginFile(file, codeRoots(dir)) }, dir);
    const sandbox = new SandboxedPlugin(port2 as unknown as SandboxPort, 'insomnia-plugin-test', undefined, timeout);
    return { sandbox, module: moduleOf(await sandbox.manifest, sandbox) };
  };

  it("loads its code and its packages' with its own require, and says what it has", async () => {
    const { module } = await load(PLUGIN);
    expect(module.templateTags?.map(({ name, displayName, description }) => ({ name, displayName, description }))).toEqual([
      { name: 'basic', displayName: 'basic', description: 'basic auth from the store' },
      { name: 'stuck', displayName: 'stuck', description: '' },
    ]);
    // the argument's hide() can't cross: data only
    expect(module.templateTags?.[0].args).toEqual([{ displayName: 'User', type: 'string' }]);
    expect(module.requestHooks).toHaveLength(1);
    expect(module.requestActions?.map(({ label, icon }) => ({ label, icon }))).toEqual([{ label: 'Say hello', icon: 'fa-hand' }]);
    expect(module.themes).toEqual([{ name: 'test-theme', displayName: 'Test', theme: { background: { default: '#000' } } }]);
  });

  it('renders a tag, calling back into its context for the store', async () => {
    const { module } = await load(PLUGIN);
    const getItem = jest.fn(async () => 'hunter2');
    const value = await module.templateTags?.[0].run({ store: { getItem }, context: {}, meta: {}, renderPurpose: 'send' } as any, 'kim');
    expect(value).toBe(Buffer.from('kim:hunter2').toString('base64'));
    expect(getItem).toHaveBeenCalledWith('password');
  });

  it("changes the app's request in a request hook, and the response's body in a response hook", async () => {
    const { module } = await load(PLUGIN);
    const renderedRequest = { _id: 'req_1', name: 'pets', url: 'https://pets.example.com', method: 'GET', headers: [], parameters: [], body: {}, authentication: {} } as any;
    await module.requestHooks?.[0]({ ...requestContext.init(renderedRequest, { team: 'blue' }) });
    expect(renderedRequest.headers).toEqual([{ name: 'X-Team', value: 'blue' }]);

    const bodyPath = path.join(dir, 'body');
    fs.writeFileSync(bodyPath, 'quiet');
    await module.responseHooks?.[0]({ ...responseContext.init({ statusCode: 200, headers: [], bodyPath, bodyCompression: null } as any) });
    expect(fs.readFileSync(bodyPath, 'utf8')).toBe('QUIET!');
  });

  it('runs an action, which can wait on the app as long as it takes', async () => {
    const { module } = await load(PLUGIN, 50);
    const alert = jest.fn(() => new Promise(resolve => setTimeout(resolve, 120)));
    const result = await module.requestActions?.[0].action({ app: { alert } } as any, { request: { name: 'pets' } } as any);
    expect(result).toBe('done');
    expect(alert).toHaveBeenCalledWith('Hello', 'pets');
  });

  it("gives up on a tag that doesn't answer", async () => {
    const { module } = await load(PLUGIN, 50);
    await expect(module.templateTags?.[1].run({ context: {} } as any)).rejects.toThrow("didn't answer in 0 seconds");
  });

  it("won't load one that needs Node.js, saying which module", async () => {
    const error = await load({ ...PLUGIN, 'index.js': 'const fs = require("fs"); module.exports.templateTags = [];' }).catch(err => err);
    expect(error).toBeInstanceOf(PluginSandboxError);
    expect(error.nodeModule).toBe('fs');
    expect(String(error.message)).toContain("Node.js's fs module");
  });

  it('answers only the context calls a plugin may make', async () => {
    writePlugin(dir, PLUGIN);
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    const sandbox = new SandboxedPlugin(port2 as unknown as SandboxPort, 'test');
    const remove = jest.fn();
    // a sandbox calling a method that isn't on the list, during a call of its own
    port1.onmessage = ({ data }) => {
      if (data.type === 'call') {
        port1.postMessage({ type: 'context', id: 1, call: data.id, method: 'util.models.request.remove', args: [] });
      } else if (data.type === 'contextResult') {
        port1.postMessage({ type: 'result', id: 1, ok: true, value: data });
      }
    };
    const answer = await sandbox.run('templateTag', 0, [], { util: { models: { request: { remove } } } });
    expect(answer).toEqual({ type: 'contextResult', id: 1, ok: false, error: "util.models.request.remove isn't something a plugin can call" });
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("what a sandboxed plugin's context does for it", () => {
  let ports: MessagePort[] = [];
  afterEach(() => {
    ports.forEach(port => port.close());
    ports = [];
  });

  // a sandbox that, during a call, makes one call back into its context and returns the answer
  const callBack = async (method: string, args: unknown[], context: Record<string, any>) => {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    const sandbox = new SandboxedPlugin(port2 as unknown as SandboxPort, 'test');
    port1.onmessage = ({ data }) => {
      if (data.type === 'call') {
        port1.postMessage({ type: 'context', id: 1, call: data.id, method, args });
      } else if (data.type === 'contextResult') {
        port1.postMessage({ type: 'result', id: 1, ok: true, value: data });
      }
    };
    return sandbox.run('templateTag', 0, [], context);
  };

  it("doesn't send requests for it", async () => {
    const sendRequest = jest.fn();
    const answer = await callBack('network.sendRequest', [{ _id: 'req_1' }], { network: { sendRequest } });
    expect(answer).toMatchObject({ ok: false, error: expect.stringContaining("can't send requests") });
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('reads a stored response\'s body by its id, not a path it gives', async () => {
    const getBodyBuffer = jest.fn(() => Buffer.from('secret'));
    const answer = await callBack('util.models.response.getBodyBuffer', [{ bodyPath: '/etc/hosts' }], { util: { models: { response: { getBodyBuffer } } } });
    expect(answer).toMatchObject({ ok: true, value: null });
    expect(getBodyBuffer).not.toHaveBeenCalled();
  });

  it('renders only tags that stay on this computer', async () => {
    const render = jest.fn(async (text: string) => text);
    const answer = await callBack('util.render', ["{% file '/etc/hosts' %}"], { util: { render } });
    expect(answer).toMatchObject({ ok: false, error: expect.stringContaining("can't render the file tag") });
    expect(render).not.toHaveBeenCalled();
  });
});

describe('starting a sandbox', () => {
  const main = (globalThis as any).window;
  afterEach(() => {
    (globalThis as any).window = main;
  });

  it("gives up on a plugin that doesn't say what it has", async () => {
    const { port1, port2 } = new MessageChannel();
    const closePluginSandbox = jest.fn();
    (globalThis as any).window = {
      main: {
        openPluginSandbox: async () => ({ id: 'sandbox-1', port: port2 }),
        closePluginSandbox,
        onPluginSandboxClosed: () => () => {},
      },
    };
    await expect(loadSandboxedPlugin('/plugins/silent', 'silent', 50)).rejects.toThrow("didn't start in 0 seconds");
    expect(closePluginSandbox).toHaveBeenCalledWith('sandbox-1');
    port1.close();
    port2.close();
  });
});

describe('reading a plugin\'s code', () => {
  let base: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-plugin-files-'));
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it('reads code under its folder, and the node_modules it sits in, and nothing else', () => {
    writePlugin(base, {
      'node_modules/insomnia-plugin-x/index.js': 'x',
      'node_modules/insomnia-plugin-x/notes.txt': 'not code',
      'node_modules/dep/index.js': 'dep',
      'secret.js': 'not the plugin\'s',
    });
    const dir = path.join(base, 'node_modules', 'insomnia-plugin-x');
    const roots = codeRoots(dir);
    expect(readPluginFile(path.join(dir, 'index.js'), roots)).toBe('x');
    expect(readPluginFile(path.join(base, 'node_modules', 'dep', 'index.js'), roots)).toBe('dep');
    expect(readPluginFile(path.join(dir, 'notes.txt'), roots)).toBeNull();
    expect(readPluginFile(path.join(base, 'secret.js'), roots)).toBeNull();
    expect(readPluginFile(path.join(dir, '..', '..', 'secret.js'), roots)).toBeNull();
  });

  it("doesn't follow a link out of it", () => {
    writePlugin(base, { 'plugin/index.js': 'x', 'outside.js': 'secret' });
    try {
      fs.symlinkSync(path.join(base, 'outside.js'), path.join(base, 'plugin', 'link.js'));
    } catch {
      // links need rights Windows may not give
      return;
    }
    expect(readPluginFile(path.join(base, 'plugin', 'link.js'), codeRoots(path.join(base, 'plugin')))).toBeNull();
  });
});

describe('the sandbox\'s Buffer', () => {
  it('encodes and decodes as Node does', () => {
    for (const text of ['kim:hunter2', 'héllo wörld ✓', '']) {
      for (const encoding of ['base64', 'hex', 'base64url', 'latin1'] as const) {
        const nodeEncoded = Buffer.from(text).toString(encoding);
        expect([text, encoding, SandboxBuffer.from(text).toString(encoding)]).toEqual([text, encoding, nodeEncoded]);
        expect(SandboxBuffer.from(nodeEncoded, encoding).toString(encoding)).toBe(nodeEncoded);
      }
    }
    expect(SandboxBuffer.concat([SandboxBuffer.from('ab'), SandboxBuffer.from('c')]).toString()).toBe('abc');
    expect(SandboxBuffer.byteLength('✓')).toBe(3);
    expect(SandboxBuffer.isBuffer(SandboxBuffer.alloc(2))).toBe(true);
  });
});
