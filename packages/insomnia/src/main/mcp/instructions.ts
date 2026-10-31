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
- \`run_test_suite\` runs a test suite's unit tests. Their code runs with the app's full access, so the app asks the user each time; say why you want to run them, and accept a no.

## Change things
- \`create_request\`, \`update_request\` (a partial patch; \`parentId\` moves it), \`duplicate_request\`, \`delete_request\`, and the same for folders (\`*_request_group\`), environments, workspaces, projects, response examples, test suites and flows.
- \`import_collection\` brings in Postman, Insomnia, Bruno, OpenAPI, HAR, curl or WSDL; \`export_workspace\` writes Insomnium, Postman, OpenAPI, Markdown or HTML.
- \`generate_code\` writes the code that sends a request: curl, fetch, Python requests and many more.

## Mock an API
- \`start_mock_server\` serves a collection's response examples (\`create_response_example\`) on 127.0.0.1, matched by method and path, so a frontend or a test can call the API before it exists. \`get_mock_server\` shows its routes and the requests it answered; \`stop_mock_server\` stops it.
- Deleting can't be undone: \`delete_workspace\` wants the workspace's exact name, and \`delete_project\` only takes an empty project. Check with the user before you delete what they didn't ask you to.

## Fewer tools
A client that connected with the minimal set (\`/sse?tools=minimal\`, or \`insomnium-mcp --minimal\`) has only the core: \`search\`, the workspace, request and environment basics, \`send_http_request\`, \`get_last_response\`, \`run_requests\` and \`generate_code\`. If a tool named here isn't offered, that's why; reconnect without it for the rest.

## Good habits
- Prefer ids from \`search\` or the list tools over guessing.
- After changing a request, send it and check the result.
- Don't send requests to hosts the user didn't mention, and don't load test anything they didn't ask you to.
`;

// the instructions as a resource, for the client to read first
export function registerInstructions(server: McpServer) {
  server.resource(
    'instructions',
    INSTRUCTIONS_URI,
    { mimeType: 'text/markdown', description: "How to use Insomnium's tools: read this first" },
    async uri => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: INSTRUCTIONS }] }),
  );
}
