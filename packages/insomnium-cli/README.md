# insomnium-cli

A command-line interface for driving a running [Insomnium](https://github.com/yokomohoyo/insomnium)
API client. It connects to the app's loopback MCP server (the same one
[`insomnium-mcp`](../insomnium-mcp) bridges) and maps each command to an MCP
tool call — so anything you change from the CLI **refreshes the app UI live**,
because the app broadcasts database changes to its windows.

Built for both humans and LLM agents: `--json` emits structured output, and the
`tools` / `describe` / `call` verbs mirror MCP's introspection surface, so an
agent can discover and invoke capabilities without hard-coded knowledge.

## Setup

1. In Insomnium: **Settings → MCP automation → enable MCP automation server**.
2. Install: `npm i -g insomnium-cli` (or `npx insomnium-cli …`).

The app must be running with the server enabled; the CLI finds it via the
discovery file the app writes (`~/.insomnium/mcp.json`).

## Usage

```sh
insomnium tools                       # list available tools
insomnium describe send_http_request  # show a tool's input schema
insomnium call list_workspaces        # invoke a tool
insomnium call send_http_request --arg requestId=req_123
insomnium call update_request --args '{"requestId":"req_123","name":"New"}'
insomnium status                      # connection health
```

### Arguments

- `--args '<json>'` — tool arguments as a JSON object.
- `--arg key=value` — a single argument (repeatable). Values are parsed as JSON
  when possible (numbers, booleans, `null`, objects), otherwise treated as a
  string. `--arg` pairs override keys from `--args`.

### Output & exit codes

- Default output is human-readable; pass `--json` for raw JSON (ideal for agents).
- Exit `0` on success, `1` on a CLI/connection error, `2` when a tool returns an
  error result — so scripts and agents can branch on the outcome.

## Configuration

- `INSOMNIUM_MCP_DISCOVERY_FILE` — override the discovery file path (must match
  the path the app writes to).

## License

MIT
