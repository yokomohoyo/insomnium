# Plugins

Plugins add template tags, change requests before they're sent or responses as they arrive, add actions to menus, and add themes. Insomnium loads the plugin format of Insomnia 2023, so most plugins written for Insomnia work: they're npm packages, usually named `insomnia-plugin-…`.

**Plugins run in a sandbox.** Each one runs in a hidden window of its own, sandboxed by your operating system and Chromium: it has no Node.js, so it can't read your files or run programs, and it can't reach the network, so the requests, tokens and responses it's shown stay here. It reaches the app only through its context (below). A plugin that needs more can be allowed [full access](#full-access).

## Install

In **Preferences → Plugins**:

- Enter a package's npm name and **Install Plugin**. **Find Plugins on npm** searches for them.
- Or **Install from File…** and choose a package tarball, as `npm pack` makes (`insomnia-plugin-example-1.0.0.tgz`). Its dependencies come from the registry, unless the package bundles them, so a plugin without dependencies (or with them bundled) installs offline.
- Or **Reveal Plugins Folder** and put the plugin's folder (with its `package.json`) in it, then **Reload Plugins** (Ctrl+Shift+R, or ⌘+Shift+R).

Turn a plugin off with its checkbox in the list, without removing it.

### Full access

Some plugins need Node.js: to read a file, use `crypto` or `fs`, or call a program. In the sandbox they don't load, and the list says which Node.js module they asked for. **Access → Full access** lets one run as the app does, with Node.js: able to read and change any of your files, run programs and send anything anywhere. Allow it only for a plugin you trust, from a publisher you trust.

A plugin with full access also renders in requests sent through the MCP server; a sandboxed one's tags render only in the app's window.

Up to Insomnium 0.4, every plugin had full access. From 0.5 each is sandboxed until you allow it.

**Registry** sets where Install Plugin gets packages from, such as a mirror or your company's own registry, instead of the npm registry. Installs go through the proxy set under **General → Network Proxy**, like requests do.

**Other plugin folders** loads plugins from folders of your own as well, such as one you're writing a plugin in. Separate them with `;` on Windows or `:` elsewhere, or put one on each line.

A link like `insomnia://plugins/install?name=insomnia-plugin-example` offers to install that plugin.

## Write one

**Generate New Plugin** makes a folder in the plugins folder with a `package.json` and a `main.js` to start from. A plugin's `package.json` names it in an `insomnia` key:

```json
{
  "name": "insomnia-plugin-example",
  "version": "1.0.0",
  "main": "main.js",
  "insomnia": {
    "name": "example",
    "displayName": "Example",
    "description": "Adds a greeting tag"
  }
}
```

Its `main` module exports any of:

| | |
|---|---|
| `templateTags` | [Template tags](template-tags.md): a name, a display name, arguments, and a `run(context, ...args)` function returning the value. |
| `requestHooks` | Functions called with a context before each request is sent: `context.request` can read and change it (headers, body, URL, parameters). |
| `responseHooks` | Functions called with a context as each response arrives: `context.response` can read it and replace its body. |
| `requestActions`, `requestGroupActions`, `workspaceActions`, `documentActions` | Items added to the menus of requests, folders, collections and documents: a label, an icon, and an `action(context, data)` function. |
| `themes` | Colour themes, shown in **Preferences → Themes**. |

```js
module.exports.templateTags = [{
  name: 'greeting',
  displayName: 'Greeting',
  description: 'says hello',
  args: [{ displayName: 'Name', type: 'string', defaultValue: 'world' }],
  run(context, name) {
    return `Hello, ${name}!`;
  },
}];

module.exports.requestHooks = [
  context => context.request.setHeader('X-Sent-By', 'insomnium'),
];
```

The context also has `context.app` (alerts, prompts, dialogs), `context.store` (values kept for the plugin) and `context.network` (to send a request from an action).

### In the sandbox

A sandboxed plugin gets the same context, with these differences:

- `require` loads the plugin's own files and the packages in its `node_modules` (`.js`, `.json`, folders with an `index.js` or a `package.json` `main`), but none of Node.js's modules: `fs`, `path`, `crypto`, `http` and the rest. `Buffer` is there, for `Buffer.from(…)`, `toString('base64')` and the like, but `process` isn't.
- There's no `fetch`, `XMLHttpRequest` or `WebSocket`. To reach a server, an action can use `context.network.sendRequest`, which sends a request as the app does.
- Calls that go to the app return promises: `context.store.*`, `context.app.alert` and `prompt`, `context.app.clipboard.readText`, `context.util.render` and `context.util.models.*`. `context.app.getPath('desktop')` and `context.app.getInfo()` stay as they were. `context.app.dialog` and `context.response.getBodyStream()` aren't available; use `getBody()`.
- A template tag's arguments are data: a `displayName`, `hide` or `validate` given as a function, and `liveDisplayName` and `disablePreview`, are left out, so the tag shows its name and every argument.
- A tag or hook that takes more than 30 seconds (not counting time waiting on a prompt) is given up on, and a plugin that hangs its sandbox is unloaded.
