# Your editor

Insomnium doesn't need an editor extension to work alongside VS Code, JetBrains IDEs, Cursor, Zed or Neovim. Keep the collection as files in your project, edit them with completion and checking, and let your editor's AI agent send requests through Insomnium.

## Requests as files, with completion

[Folder Sync](folder-sync.md) keeps a collection in a folder of YAML files, a file per request, in step with the app. It also writes the files' JSON Schema to `.insomnium/folder.schema.json` in that folder, and each file names it on its first line:

```yaml
# yaml-language-server: $schema=../.insomnium/folder.schema.json
_id: req_9f3c…
type: Request
name: Create order
method: POST
url: "{{ base_url }}/orders"
```

So an editor that understands YAML schemas completes the fields as you type (a request's `method`, `headers`, `body`, `assertions`…), describes them on hover, and marks a mistake such as a misspelled `type` or a header without a `name`:

- **VS Code**, and Cursor or VSCodium: install Red Hat's **YAML** extension. The first line is all it needs.
- **Zed**, **Neovim**, **Helix** and others with `yaml-language-server`: the first line is all it needs too.
- **JetBrains IDEs**: in **Settings → Languages & Frameworks → Schemas and DTDs → JSON Schema Mappings**, add `.insomnium/folder.schema.json` for the folder's `*.yaml` files.

An edit you save is in the app at once, and a change in the app is in the file. Commit the folder, `.insomnium/` included, to share it.

## Your editor's agent, sending requests

Insomnium's [MCP server](mcp-server.md) lets an AI agent list your collections, send requests, and read the responses, with your environments and auth. Turn it on in **Preferences → Automation (MCP)**, which shows its address and token, then add it to your editor:

- **VS Code** (agent mode), in `.vscode/mcp.json`:

  ```json
  {
    "servers": {
      "insomnium": {
        "type": "sse",
        "url": "http://127.0.0.1:<port>/sse",
        "headers": { "Authorization": "Bearer <token>" }
      }
    }
  }
  ```

- **Cursor**, in `~/.cursor/mcp.json`: the same, under `"mcpServers"`.
- **JetBrains** AI Assistant: **Settings → Tools → AI Assistant → Model Context Protocol (MCP)**, add a server with that URL and header.
- **Claude Code**: Preferences shows the `claude mcp add` command to paste.

Keep the token out of files you commit: VS Code can prompt for it with an input variable instead.

`insomnium agent install` adds a skill that tells a coding agent how to use your collections: find a request, check the environment, send it, read the response and its assertions. See [the CLI](../packages/insomnium-cli/README.md#for-coding-agents).

## From the terminal

[`insomnium-server run`](../packages/insomnium-server/README.md#run-a-collection-in-ci) runs a collection's requests and their assertions without the app, as a task or a pre-commit check; `load` load tests them, and `mock` answers as they would.
