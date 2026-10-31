# MCP requests

An **MCP Request** tries out an MCP (Model Context Protocol) server the way an AI agent would use it: connect, see what it offers, and call its tools, prompts and resources by hand. It's for checking a server you're building, or one you're about to give an agent.

To let an agent use *your collections* over MCP instead, see [the MCP automation server](mcp-server.md).

## Connect

Add one with the **+** button above the sidebar, then pick the transport, left of the address:

- **HTTP**: the server's URL, such as `https://example.com/mcp`. Add any headers it needs, an `Authorization` header say, in the **Headers** tab. Insomnium tries streamable HTTP first and falls back to the older SSE transport, and the response pane says which one connected.
- **STDIO**: the command that starts the server, such as `npx -y @modelcontextprotocol/server-everything`, with its arguments one per line in the **Arguments** tab. It runs with your PATH and home folder, but not the app's other environment variables.

Variables and template tags work in the URL, the headers, the command and its arguments, so a token can come from an [environment](getting-started.md#environments).

Then **Connect** (or Ctrl+Enter, ⌘+Enter on macOS). **Disconnect** closes the connection; click **Connecting…** to stop one still connecting.

**A command asks first.** A collection you imported or cloned could hold any command, so before every STDIO connect Insomnium shows the exact command and asks **Run the MCP Server?**, with **Cancel** and **Run**. It runs with your permissions: run only what you trust.

## Try what it offers

Once connected, the response pane shows the server's name, version and transport, and four tabs:

- **Tools**: pick a tool, read its description, fill in its arguments as JSON and **Call** it. The arguments start from the tool's input schema.
- **Prompts**: the same for a prompt, with **Get**.
- **Resources**: pick one by name and URI and **Read** it.
- **Instructions**: what the server tells agents about using it, if anything.

The result shows as JSON, marked **Error** when the call failed or the tool reported an error. Variables and tags work in the arguments too. The arguments you last used for each tool and prompt are kept with the request, so the next call starts from them.

The **Docs** tab holds a description of the server, in Markdown.

## Things to know

- An MCP request is part of the collection: it's exported, synced with Git Sync and copied like any other request. Tool results aren't kept in the response history.
- An agent connected to the [automation server](mcp-server.md) can open the same connection and call the same tools; the app's window shows it. A STDIO command still asks you first.
