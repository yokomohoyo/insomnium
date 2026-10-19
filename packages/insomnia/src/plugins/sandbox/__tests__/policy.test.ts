import { describe, expect, it } from '@jest/globals';

import { applyHookRequest, checkManifest, checkRender, deniedCall, destinationOf, safeTheme } from '../policy';

const manifest = (patch: Record<string, unknown> = {}) => ({
  templateTags: [{ name: 'greet', displayName: 'Greet', description: '', args: [], actions: [] }],
  requestHooks: 1,
  responseHooks: 0,
  requestActions: [{ label: 'Say hello' }],
  requestGroupActions: [],
  workspaceActions: [],
  documentActions: [],
  themes: [],
  ...patch,
});

describe("a sandboxed plugin's calls", () => {
  it("can't send requests or import from a URL", () => {
    expect(deniedCall('network.sendRequest', 'p')?.message).toContain("can't send requests");
    expect(deniedCall('data.import.uri', 'p')?.message).toContain("can't import from a URL or a file");
    expect(deniedCall('store.getItem', 'p')).toBeNull();
  });

  it('render only the tags that stay on this computer', () => {
    expect(() => checkRender("{% base64 'encode', 'normal', 'hi' %} {% if x %}{{ y }}{% endif %} {%- now 'iso-8601' -%}", 'p')).not.toThrow();
    expect(() => checkRender("{% file '/etc/hosts' %}", 'p')).toThrow("can't render the file tag");
    expect(() => checkRender("{%- vault 'https://example.com' %}", 'p')).toThrow("can't render the vault tag");
    expect(() => checkRender("{% response 'body', 'req_1', '', 'always' %}", 'p')).toThrow("can't render the response tag");
    // another plugin's tag
    expect(() => checkRender('{% somePluginTag %}', 'p')).toThrow("can't render the somePluginTag tag");
  });
});

describe("a sandboxed request hook's changes", () => {
  const request = () => ({
    url: 'https://api.example.com/pets',
    method: 'GET',
    headers: [] as unknown[],
    body: { mimeType: 'multipart/form-data', params: [{ name: 'photo', type: 'file', fileName: '/home/kim/pet.png' }] },
    authentication: { type: 'bearer', token: 'abc' },
  });

  it('change the headers, the path, the body and the auth token', () => {
    const sent = request();
    applyHookRequest(sent, {
      url: 'https://API.example.com/pets?page=2',
      headers: [{ name: 'X-Team', value: 'blue' }],
      body: { mimeType: 'multipart/form-data', params: [{ name: 'photo', type: 'file', fileName: '/home/kim/pet.png' }, { name: 'note', value: 'hi' }] },
      authentication: { type: 'bearer', token: 'def' },
      _id: 'req_other',
    }, 'p');
    expect(sent).toMatchObject({ url: 'https://API.example.com/pets?page=2', headers: [{ name: 'X-Team', value: 'blue' }], authentication: { token: 'def' } });
    // what the request context can't set stays as it was
    expect(sent).not.toHaveProperty('_id');
  });

  it("don't send it to another server, add a file, or point its auth elsewhere", () => {
    const sent = request();
    expect(() => applyHookRequest(sent, { url: 'https://elsewhere.example.net/pets' }, 'p')).toThrow('another server');
    expect(() => applyHookRequest(sent, { url: 'https://api.example.com@elsewhere.example.net/' }, 'p')).toThrow('another server');
    expect(() => applyHookRequest(sent, { url: 'file:///etc/hosts' }, 'p')).toThrow('another server');
    expect(() => applyHookRequest(sent, { body: { mimeType: 'application/octet-stream', fileName: '/home/kim/.ssh/id_ed25519' } }, 'p')).toThrow('add a file');
    expect(() => applyHookRequest(sent, { authentication: { type: 'oauth2', accessTokenUrl: 'https://elsewhere.example.net/token' } }, 'p')).toThrow('authentication');
    expect(sent).toEqual(request());
  });

  it("can't set the object's prototype", () => {
    const sent = request();
    const changed = JSON.parse('{"__proto__": {"polluted": true}, "method": "POST"}');
    applyHookRequest(sent, changed, 'p');
    expect(sent.method).toBe('POST');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(sent)).toBe(Object.prototype);
  });

  it('tell a Unix socket by its path', () => {
    expect(destinationOf('http://unix:/var/run/app.sock:/pets')).toBe('http://unix:/var/run/app.sock');
    expect(destinationOf('http://unix:/var/run/app.sock:/pets')).not.toBe(destinationOf('http://unix:/var/run/other.sock:/'));
  });
});

describe("a sandbox's manifest", () => {
  it('is taken as it says, when it says it in numbers the app can take', () => {
    expect(checkManifest(manifest(), 'p').requestHooks).toBe(1);
  });

  it("isn't, when it doesn't", () => {
    expect(() => checkManifest(manifest({ requestHooks: 2 ** 32 - 1 }), 'p')).toThrow("in a way the app can't use");
    expect(() => checkManifest(manifest({ responseHooks: -1 }), 'p')).toThrow();
    expect(() => checkManifest(manifest({ templateTags: [{ name: 'bad name', args: [], actions: [] }] }), 'p')).toThrow();
    expect(() => checkManifest(manifest({ requestActions: Array.from({ length: 1000 }, () => ({ label: 'x' })) }), 'p')).toThrow();
    expect(() => checkManifest(null, 'p')).toThrow();
  });

  it("keeps a theme's colours, but not names or CSS that would change the window's CSS", () => {
    const theme = { name: 'night', displayName: 'Night', theme: { background: { default: '#000' } } };
    expect(safeTheme(theme, 'p')).toEqual([theme]);
    expect(safeTheme({ ...theme, name: 'x"] * { color: red } [x="' }, 'p')).toEqual([]);
    expect(safeTheme({ ...theme, theme: { ...theme.theme, rawCss: 'input[value^="a"] { background: url(https://example.com/a) }' } }, 'p')).toEqual([theme]);
    expect(safeTheme({ ...theme, theme: { ...theme.theme, rawCss: '.pane { border: 1px solid red; }' } }, 'p')[0].theme).toHaveProperty('rawCss');
    expect(checkManifest(manifest({ themes: [theme, { name: 'bad name' }] }), 'p').themes).toEqual([theme]);
  });
});
