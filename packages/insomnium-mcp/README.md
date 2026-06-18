# insomnium-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) stdio launcher that
bridges AI clients (Claude Code, Claude Desktop, etc.) to a locally running
[Insomnium](https://github.com/yokomohoyo/insomnium) API client. Once connected,
an MCP client can list, inspect, and run your saved REST / GraphQL / gRPC
requests, manage environments, and send HTTP requests through Insomnium.

## How it works

Insomnium runs its MCP server inside the desktop app, on a loopback HTTP+SSE
endpoint (`127.0.0.1`) protected by a per-instance bearer token. Those
coordinates change per machine and per launch, so they can't be hard-coded.

When you enable the server, the app writes a discovery file
(`~/.insomnium/mcp.json` by default, mode `600`) containing the live port and
token. `insomnium-mcp` reads that file and transparently relays JSON-RPC between
your MCP client (stdio) and the app (SSE):

```
MCP client  ──stdio──▶  insomnium-mcp  ──HTTP+SSE──▶  Insomnium app (127.0.0.1)
```

## Usage

1. In Insomnium, open **Settings → MCP automation** and enable
   **MCP automation server**.
2. Register this launcher with your MCP client as a **stdio** server:

   ```sh
   npx insomnium-mcp
   ```

   For Claude Code:

   ```sh
   claude mcp add insomnium npx insomnium-mcp
   ```

The app must be running with the server enabled whenever the client connects.

> You can connect directly over SSE instead (the Settings panel shows a ready-made
> `claude mcp add --transport sse …` command). This launcher exists so MCP clients
> that only speak stdio — and the MCP registry — have a stable entry point.

## Configuration

- `INSOMNIUM_MCP_DISCOVERY_FILE` — override the discovery file path (must match
  the path the app writes to).

## License

MIT
