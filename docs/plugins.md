# Plugins

Plugins add template tags, change requests before they're sent or responses as they arrive, add actions to menus, and add themes. Insomnium loads the plugin format of Insomnia 2023, so most plugins written for Insomnia work: they're npm packages, usually named `insomnia-plugin-…`.

**A plugin runs with the same access as the app**: it can read your files and reach the network. Install only plugins you trust. (Scripts are different: they run in a [sandbox](scripts.md#the-sandbox).)

## Install

In **Preferences → Plugins**:

- Enter a package's npm name and **Install Plugin**. This needs the npm registry.
- Or, offline, **Reveal Plugins Folder** and put the plugin's folder (with its `package.json`) in it, then **Reload Plugins** (Ctrl+Shift+R, or ⌘+Shift+R).

Turn a plugin off with its checkbox in the list, without removing it.

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
