---
name: insomnium
description: Test and debug HTTP and gRPC APIs with the user's Insomnium collections - find saved requests, send them with the right environment and auth, read the responses, check assertions, run a whole collection, and add or change requests. Use when the user asks to call, test, check or debug an API they keep in Insomnium, or to add a request to a collection.
---

# Insomnium

Insomnium is the user's local API client. Its collections hold their requests, environments (base URLs, tokens) and auth, so send through Insomnium rather than writing curl by hand: the request then goes out exactly as the user would send it, and the response lands in their history.

Insomnium's tools are available two ways:

- **MCP**: tools named like `list_workspaces`, `send_http_request` (`mcp__insomnium__*`), when the Insomnium MCP server is connected.
- **The CLI**: `insomnium call <tool> --arg key=value --json`. `insomnium tools` lists the tools and `insomnium describe <tool>` shows a tool's arguments. The app must be running with **Preferences → Automation (MCP)** enabled.

## Finding a request

1. `list_workspaces`: the collections (and design documents), with their ids.
2. `list_requests` with a `workspaceId`: every request, with its id, method, URL and folder (`parentId`). `list_request_groups` gives the folder names.
3. `get_request` for the details: headers, body, auth, parameters.

Match the user's words against request names and URLs. If two fit, ask which one.

## Sending

- `get_active_environment` shows which environment is in use (staging, production...). Check it before sending somewhere that matters, and `set_active_environment` if the user asked for another.
- `send_http_request` with a `requestId` sends it as the app would: variables, auth, the pre-request script, cookies. The result has the status, timing, the body (cut short when large) and any assertion results.
- `send_grpc_request` for gRPC; streaming calls need a `messages` list.
- `get_last_response` or `list_responses` shows what an earlier send got.

Don't send requests that change data (POST, PUT, PATCH, DELETE) to a production environment unless the user asked for exactly that.

## Testing

- A request's assertions and after-response script tests run on every send. Their results come back with the response.
- `run_requests` with a workspace or folder id runs its requests in order, with a pass or fail for each and a summary. Use it to check a whole API, or a flow such as sign in, then create, then read.

## Changing a collection

- `create_request` (in a workspace or folder, `parentId`), `update_request` and `delete_request`. Read `get_request` first and patch only what changes.
- `create_request_group` adds a folder.
- `create_response_example` (and `update_`, `delete_`, `list_response_examples`) fills a request's Examples tab: name, status, headers and body.
- In a design document: `set_spec` sets the Spec tab's YAML or JSON (`get_spec` reads it); `create_test_suite` and `create_unit_test` fill the Test tab; `create_flow` and `update_flow` fill the Flows tab (`get_flow` reads one's graph).
- `update_environment` changes a variable; `create_environment` adds a sub environment.
- `add_auth_strategy` / `update_auth_strategy` set auth; a request with empty auth uses its folder's.
- `import_collection` imports text in any format the app imports (curl, OpenAPI, Postman, Insomnia, HAR...) into a workspace.
- `export_workspace` exports a collection, as Insomnium's format, as a Postman collection, as an OpenAPI description of its requests, or as API documentation (Markdown, or one HTML page).

The app shows these changes straight away. Tell the user what you changed.

## Variables and secrets

Values like `{{ base_url }}` and `{{ token }}` come from the environment, and are filled in when a request is sent: use them in new requests rather than copying values in. Environment values and secret fields aren't shown in full over MCP; don't ask the user to paste secrets into the chat.
