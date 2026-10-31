# The MCP automation server

Insomnium can run a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server, so an AI assistant or coding agent (Claude Code, Claude Desktop, Cursor and other MCP clients) can work with your collections: find a request, send it with its environment and auth, read the response and its assertions, run a folder, and add or change requests. Anything a tool changes shows up in the app straight away.

To try out an MCP server of your own instead, use an [MCP request](mcp-requests.md).

## Turn it on

1. Open **Preferences** (Ctrl+, or ⌘+,) and choose **Automation (MCP)**.
2. Turn on **Enable MCP automation server**. It's off until you do.
3. Leave **Port** at `0` to let the system pick a free port each time, or set one to keep the connection URL the same across restarts.

The panel then shows the **Auth token**, the **Connection URL** and a **Claude Code install command**, each with **Copy**. **Regenerate** makes a new token; clients using the old one have to connect again.

The server listens on `127.0.0.1` only, so nothing else on your network can reach it, and every call needs the token. While it runs, Insomnium writes the port and token to `~/.insomnium/mcp.json` (readable only by you), which is how the tools below find it.

## Connect a client

The simplest way is the `insomnium-mcp` launcher, which reads the token from the running app, so there's nothing to copy:

```sh
claude mcp add insomnium npx insomnium-mcp
```

For another client, add a stdio server whose command is `npx insomnium-mcp`. Or connect over SSE with the URL and token from the panel:

```sh
claude mcp add --transport sse insomnium http://127.0.0.1:<port>/sse --header "Authorization: Bearer <token>"
```

The app has to be running, with the server on, whenever the client connects.

**Fewer tools.** A client with little room for tool descriptions can take just the core ones (search, read and edit requests, environments, send, run and generate code): `npx insomnium-mcp --minimal`, or `…/sse?tools=minimal`.

## What a client can do

Each client is told to read the `insomnium://instructions` resource first: how to find, send, check and change requests with these tools. Between them, the tools cover:

- **Find things:** list projects, collections, folders and requests of every type, and `search` them by name or URL across collections.
- **Send:** HTTP and GraphQL requests (`send_http_request`) and gRPC ones of all four kinds (`send_grpc_request`), with the request's environment, auth and scripts, and optionally another environment (and, for gRPC, a timeout). An HTTP request sent this way doesn't follow redirects. Read a request's recent responses, and the last body.
- **Live connections:** open a WebSocket, Socket.IO, MQTT or GraphQL subscription and read its messages, and send on a plain WebSocket; open an event stream and read what it received; connect an MCP request to its server and call its tools. The connection shows in the app's window too.
- **Run and test:** run a collection's or folder's requests with their assertions (`run_requests`), run a flow step by step (`run_flow`), and list, create and change unit test suites and tests.
- **Change things:** create requests of every type, folders, projects and collections; update, move, copy and delete them; add, change and remove auth; edit environments and switch the active one; list, set and delete cookies.
- **Design documents:** read and set the spec, lint it, and generate requests from it.
- **Examples and mocks:** list, create and change a request's response examples, and start and stop a collection's [mock server](mock-server.md) and read the requests it got.
- **Import, export and code:** import anything the app imports, export as Insomnium, Postman or OpenAPI (or as Markdown or HTML docs), and turn a request into code (cURL, fetch, Python requests and the rest of **Generate Code**).
- **gRPC protos:** list and import `.proto` files, see their services and methods, and set metadata.

**Some things ask you first.** Running a design document's unit tests, a Git commit, pull or push, and an MCP request that runs a command each open a confirmation in the app, with **Cancel** the default. Deleting a collection (`delete_workspace`) needs its name repeated exactly.

## From the command line

`insomnium-cli` calls the same tools from a terminal or a script:

```sh
npm i -g insomnium-cli        # or, without installing: npx insomnium-cli …
```

```sh
insomnium status                                              # is the app reachable?
insomnium tools                                               # every tool, and
insomnium describe send_http_request                          # what one takes
insomnium call list_workspaces                                # your collections, with ids
insomnium call send_http_request --arg requestId=req_123      # send a request
insomnium call run_requests --arg parentId=fld_123 --json     # run a folder, as JSON
```

Give arguments with `--arg key=value` (repeatable; values are read as JSON where they can be) or `--args '<json>'`. A tool that fails exits with `2`, so a script can stop on it; a connection problem exits with `1`.

`insomnium agent install` adds a skill to Claude Code (`--dir` for another agent's skills folder) that teaches the agent to use your collections this way.

Every option: [insomnium-cli](../packages/insomnium-cli/README.md).

## Without the app

[insomnium-server](../packages/insomnium-server/README.md) runs the read and send tools in a container, from an exported collection or a Git Sync repository, for an agent that has to test APIs inside a cluster or a staging network. It can't change the collection. The same image runs a collection in CI, load tests it and mocks it.

## Things to know

- **What a client sees.** `get_request` and `list_auth_strategies` mask passwords, client secrets, tokens and auth headers, and so do stored responses' headers. But `export_workspace` and `generate_code` give the real values, a request a client sends goes with them, and response bodies come back as the server sent them. Connect clients you trust, and **Regenerate** the token if one shouldn't have it any more.
- **The token file.** `~/.insomnium/mcp.json` holds the token in plain text while the server runs, so tools can find it. It isn't covered by [saved credentials](../README.md#saved-credentials) encryption.
- **Another discovery file.** Set `INSOMNIUM_MCP_DISCOVERY_FILE` for `insomnium-mcp` and `insomnium-cli` if the app writes it somewhere else.
