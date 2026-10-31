import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// What an agent should know before it uses the tools: the server's
// instructions point at it, and it's served as a resource to read first.

export const INSTRUCTIONS_URI = 'insomnium://instructions';

export const SERVER_INSTRUCTIONS = `Insomnium is a local API client: your collections, environments and history live on this computer. Read the resource ${INSTRUCTIONS_URI} before your first tool call; it says how to find, send, test and change requests.`;

export const INSTRUCTIONS = `# Using Insomnium's tools

Everything here works on the user's own collections, on their computer. Changes show in the app straight away.

## Find what you need
- \`search\` finds requests, folders, workspaces and environments by name, and requests by URL or method. Start here when you know roughly what you want.
- \`list_workspaces\` (with \`list_projects\`) gives every collection and design document; \`list_requests\` and \`list_request_groups\` list one workspace's.
- \`get_request\` shows a request in full. Read it before you change it.

## Environments
- \`get_active_environment\` says which environment a send uses; \`list_environments\` lists a workspace's, and \`set_active_environment\` switches.
- Don't ask the user for tokens or passwords their environments already hold: send the request and the app fills them in.

## Send and check
- \`send_http_request\` sends one request as the Send button does: pre-request script, rendering, auth, cookies, after-response script and assertions. It returns the status, time, assertion results and what the scripts logged. Read the body with \`get_last_response\` or \`get_response\`.
- \`send_grpc_request\` calls a gRPC method (see \`get_proto_methods\`).
- \`run_requests\` runs a workspace's or folder's HTTP requests in order, with iterations, and returns each result with its time and phases (DNS, connect, TLS, waiting, download) and each request's latency percentiles.
- \`run_flow\` runs a flow: requests joined with conditions and variables.
- \`connect_event_stream\` opens an event stream (Server-Sent Events) request's connection; \`read_event_stream\` shows what it received, newest first; \`close_event_stream\` closes it. The app's window shows the same connection.
- \`connect_websocket\` opens a WebSocket request's connection (a plain socket, GraphQL subscription, Socket.IO or MQTT, as it's set up); \`send_websocket_message\` sends on a plain one; \`read_websocket_messages\` shows what went each way, newest first; \`close_websocket\` closes it. The app's window shows the same connection.
- \`run_test_suite\` runs a test suite's unit tests. Their code runs with the app's full access, so the app asks the user each time; say why you want to run them, and accept a no.

## Change things
- \`create_request\`, \`update_request\` (a partial patch; \`parentId\` moves it), \`duplicate_request\`, \`delete_request\`, and the same for folders (\`*_request_group\`), environments, workspaces, projects, response examples, test suites and flows.
- \`import_collection\` brings in Postman, Insomnia, Bruno, OpenAPI, HAR, curl or WSDL; \`export_workspace\` writes Insomnium, Postman, OpenAPI, Markdown or HTML.
- \`generate_code\` writes the code that sends a request: curl, fetch, Python requests and many more.

## Mock an API
- \`start_mock_server\` serves a collection's response examples (\`create_response_example\`) on 127.0.0.1, matched by method and path, so a frontend or a test can call the API before it exists. \`get_mock_server\` shows its routes and the requests it answered; \`stop_mock_server\` stops it.
- Deleting can't be undone: \`delete_workspace\` wants the workspace's exact name, and \`delete_project\` only takes an empty project. Check with the user before you delete what they didn't ask you to.

## Git
- For a workspace synced with Git, \`git_status\` shows its branch and what changed since the last commit, and \`git_log\` its recent commits.
- \`git_commit\`, \`git_pull\` and \`git_push\` change history, so the app asks the user each time. Say what you'll commit or push before you ask, and accept a no. Conflicts from a pull are settled in the app, not here.

## Fewer tools
A client that connected with the minimal set (\`/sse?tools=minimal\`, or \`insomnium-mcp --minimal\`) has only the core: \`search\`, the workspace, request and environment basics, \`send_http_request\`, \`get_last_response\`, \`run_requests\` and \`generate_code\`. If a tool named here isn't offered, that's why; reconnect without it for the rest.

## Good habits
- Prefer ids from \`search\` or the list tools over guessing.
- After changing a request, send it and check the result.
- Don't send requests to hosts the user didn't mention, and don't load test anything they didn't ask you to.
`;

// The headless server's (insomnium-server): the collections it loaded, to
// read, send and run; nothing it offers changes them
export const HEADLESS_SERVER_INSTRUCTIONS = `This is Insomnium's headless server: it serves the API collections it was started with, to read, send and run. Read the resource ${INSTRUCTIONS_URI} before your first tool call.`;

export const HEADLESS_INSTRUCTIONS = `# Using Insomnium's headless server

It serves the collections it was started with (files or Git repositories), read-only: nothing here changes them. It sends only to the hosts it allows.

## Find what you need
- \`search\` finds requests, folders, workspaces and environments by name, and requests by URL or method.
- \`list_workspaces\`, \`list_request_groups\` and \`list_requests\` list what's loaded; \`get_request\` shows a request in full.
- \`get_spec\`, \`list_test_suites\`, \`list_flows\` and \`get_flow\` show a design document's spec, tests and flows.

## Environments
- \`list_environments\` and \`get_active_environment\` show them; \`set_active_environment\` picks the one sends use.

## Send and check
- \`send_http_request\` sends one request with its scripts and assertions; read the body with \`get_last_response\` or \`get_response\`.
- \`send_grpc_request\` calls a gRPC method (see \`get_proto_methods\`).
- \`run_requests\` runs a workspace's or folder's requests, with iterations, and returns each result with its time and phases and each request's latency percentiles. \`run_flow\` runs a flow.
- \`generate_code\` writes the code that sends a request; \`export_workspace\` exports what's loaded.
`;

// the instructions as a resource, for the client to read first: the app's, or
// the headless server's
export function registerInstructions(server: McpServer, text = INSTRUCTIONS) {
  server.resource(
    'instructions',
    INSTRUCTIONS_URI,
    { mimeType: 'text/markdown', description: "How to use Insomnium's tools: read this first" },
    async uri => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }),
  );
}
