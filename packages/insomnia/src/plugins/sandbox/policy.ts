// What a sandboxed plugin can do with the app's side of its context, beyond
// its sandbox: the calls the app answers for it reach no file, program or
// server of the plugin's choosing, and what it sends back (a hook's request,
// its manifest, its themes) is checked before the app uses it. A plugin with
// full access has the app's own context instead.
import type { Manifest } from './protocol';

const fullAccessHint = 'allow it full access in Preferences → Plugins if it needs to';

// calls a sandboxed plugin can't make, and why
export const DENIED_CALLS: Record<string, string> = {
  'network.sendRequest': "can't send requests",
  'data.import.uri': "can't import from a URL or a file",
};

export const deniedCall = (method: string, plugin: string) =>
  DENIED_CALLS[method] ? new Error(`The plugin ${plugin} ${DENIED_CALLS[method]} from its sandbox: ${fullAccessHint}`) : null;

// the tags a sandboxed plugin's util.render can use: the built-in ones that
// read no file, run no program, reach no server and send no request; and
// Nunjucks's own statements. Other plugins' tags aren't among them.
export const SANDBOX_RENDER_TAGS = new Set([
  'base64', 'now', 'uuid', 'hash', 'hmac', 'jwt', 'random', 'faker', 'jsonpath', 'cookie', 'prompt', 'request', 'os', 'env',
  'if', 'elif', 'elseif', 'else', 'endif', 'for', 'endfor', 'set', 'endset', 'raw', 'endraw', 'verbatim', 'endverbatim',
]);

export function checkRender(text: unknown, plugin: string) {
  if (typeof text !== 'string') {
    return;
  }
  for (const [, tag] of text.matchAll(/\{%-?\s*([A-Za-z_$][\w$]*)/g)) {
    if (!SANDBOX_RENDER_TAGS.has(tag)) {
      throw new Error(`The plugin ${plugin} can't render the ${tag} tag from its sandbox: ${fullAccessHint}`);
    }
  }
}

// what a sandboxed hook can change of a request: what the request context's setters change
const HOOK_FIELDS = [
  'method', 'url', 'headers', 'parameters', 'cookies', 'authentication', 'body',
  'settingSendCookies', 'settingStoreCookies', 'settingEncodeUrl', 'settingDisableRenderRequestBody', 'settingFollowRedirects',
];

// where a URL goes: its scheme and host (with a Unix socket's path)
export const destinationOf = (url: unknown) => {
  const text = String(url ?? '').trim().toLowerCase();
  return text.match(/^https?:\/\/unix:[^:]*/)?.[0] ?? text.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#]*/)?.[0] ?? '';
};

// the files a body sends: a file body's, and a multipart body's file fields'
const filesOf = (body: any): string[] => [
  body?.fileName,
  ...(Array.isArray(body?.params) ? body.params : []).map((param: any) => (param?.type === 'file' ? param.fileName : undefined)),
].filter((file): file is string => typeof file === 'string' && file !== '');

const urlsIn = (value: unknown) => JSON.stringify(value ?? null).match(/[a-z][a-z0-9+.-]*:\/\/[^"\s\\]*/gi) ?? [];

// a sandboxed request hook's changes, onto the request the app sends: it
// can't send the request to another server, add a file of this computer to
// it, or point its authentication at another URL
export function applyHookRequest(request: Record<string, any>, changed: unknown, plugin: string) {
  if (!changed || typeof changed !== 'object') {
    return;
  }
  const refuse = (what: string) => new Error(`The plugin ${plugin} can't ${what} from its sandbox: ${fullAccessHint}`);
  const next: Record<string, unknown> = {};
  for (const key of HOOK_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(changed, key)) {
      next[key] = (changed as Record<string, unknown>)[key];
    }
  }
  if ('url' in next && destinationOf(next.url) !== destinationOf(request.url)) {
    throw refuse('send the request to another server');
  }
  if ('body' in next) {
    const had = new Set(filesOf(request.body));
    if (filesOf(next.body).some(file => !had.has(file))) {
      throw refuse('add a file to the request');
    }
  }
  if ('authentication' in next) {
    const before = request.authentication;
    const after = next.authentication as { type?: string } | undefined;
    const had = new Set(urlsIn(before));
    // OAuth 2.0 fetches its token: switching to it would fetch from wherever the plugin said
    if (urlsIn(after).some(url => !had.has(url)) || (after?.type === 'oauth2' && before?.type !== 'oauth2')) {
      throw refuse("point the request's authentication somewhere else");
    }
  }
  for (const [key, value] of Object.entries(next)) {
    request[key] = value;
  }
}

const MAX_ENTRIES = 100;
const NAME = /^[A-Za-z_$][\w$]*$/;
const THEME_NAME = /^[\w-]{1,100}$/;
// CSS that fetches, or hides what it is behind escapes
const UNSAFE_CSS = /url\s*\(|@import|image-set|image\s*\(|\\|expression\s*\(|src\s*:/i;

const count = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_ENTRIES;
const list = (value: unknown) => Array.isArray(value) && value.length <= MAX_ENTRIES;

// a sandboxed plugin's theme as the app can use it, or nothing: its names
// go into the window's CSS selectors, and its raw CSS into the window
export function safeTheme(theme: any, plugin: string) {
  const styles = theme?.theme?.styles;
  if (
    !theme || typeof theme !== 'object' || typeof theme.name !== 'string' || !THEME_NAME.test(theme.name)
    || !theme.theme || typeof theme.theme !== 'object'
    || (styles !== undefined && (typeof styles !== 'object' || Object.keys(styles ?? {}).some(style => !THEME_NAME.test(style))))
  ) {
    console.warn(`[plugin] ${plugin}'s theme isn't one the app can use`);
    return [];
  }
  const { rawCss, ...rest } = theme.theme;
  if (rawCss !== undefined && (typeof rawCss !== 'string' || UNSAFE_CSS.test(rawCss))) {
    console.warn(`[plugin] ${plugin}'s theme ${theme.name} is used without its raw CSS, which a sandboxed plugin's can't fetch or escape`);
    return [{ ...theme, displayName: String(theme.displayName ?? theme.name), theme: rest }];
  }
  return [{ ...theme, displayName: String(theme.displayName ?? theme.name) }];
}

// a sandbox's manifest, checked: what it says it has, in numbers the app can take
export function checkManifest(manifest: unknown, plugin: string): Manifest {
  const m = manifest as Manifest;
  const actions = [m?.requestActions, m?.requestGroupActions, m?.workspaceActions, m?.documentActions];
  if (
    !m || typeof m !== 'object' || !count(m.requestHooks) || !count(m.responseHooks)
    || !list(m.templateTags) || !list(m.themes) || !actions.every(list)
    || m.templateTags.some(tag => !tag || typeof tag.name !== 'string' || !NAME.test(tag.name) || !list(tag.args) || !list(tag.actions))
    || actions.some(items => items.some(item => !item || typeof item.label !== 'string'))
  ) {
    throw new Error(`The plugin ${plugin} described what it has in a way the app can't use`);
  }
  return { ...m, themes: m.themes.flatMap(theme => safeTheme(theme, plugin)) };
}
