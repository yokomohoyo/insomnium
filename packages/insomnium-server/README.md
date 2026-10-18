# insomnium-server

Insomnium's MCP tools without the app. It loads a collection and lets AI clients (Claude Code and other MCP clients) list its requests and send them, over MCP's Streamable HTTP transport. Run it in a container next to the APIs an agent should test: inside a cluster, a VPC, or a staging network the agent can't reach directly.

It reads and sends; it can't change the collection, its environments or auth.

## Run it

Build the image from the repository root:

```sh
docker build -f packages/insomnium-server/Dockerfile -t insomnium-server .
```

Export a collection from Insomnium (or use an Insomnia v4/v5 export, or a Postman collection), and run:

```sh
docker run -p 8080:8080 \
  -v "$PWD/collection.yaml:/data/collection.yaml:ro" \
  -e INSOMNIUM_MCP_TOKEN="$(openssl rand -base64 32)" \
  -e INSOMNIUM_ALLOWED_HOSTS="api.internal.example.com,*.staging.example.com" \
  -e INSOMNIUM_VAR_apiKey="$API_KEY" \
  insomnium-server --collection /data/collection.yaml --env staging
```

Then point an MCP client at `http://<host>:8080/mcp` with the header `Authorization: Bearer <token>`. For Claude Code:

```sh
claude mcp add --transport http insomnium http://localhost:8080/mcp --header "Authorization: Bearer <token>"
```

## Options

| | |
|---|---|
| `--collection <file>` | A collection to load; repeat for more. |
| `--env <name>` | The sub environment to send with. |
| `--host`, `--port` | Where to listen (`INSOMNIUM_HOST`, `INSOMNIUM_PORT`; the image uses `0.0.0.0:8080`). |
| `INSOMNIUM_MCP_TOKEN` | **Required**, 32+ characters. Clients send it as a bearer token. |
| `INSOMNIUM_ALLOWED_HOSTS` | **Required**. Comma-separated hosts requests may go to: `api.example.com`, `*.example.com` (subdomains), `10.0.0.5`, or `*` for any. |
| `INSOMNIUM_VAR_<name>` | Sets `<name>` in the chosen environment (or the base one), so secrets come from the deployment rather than the collection file. |
| `INSOMNIUM_VALIDATE_SSL` | `false` to skip certificate validation. |

`GET /health` answers without a token, for health checks.

## What it allows

The server can reach whatever its network can, so it only sends where you say:

- Requests, and gRPC calls and reflection, go only to `INSOMNIUM_ALLOWED_HOSTS`, over http, https or gRPC. Unix sockets and other schemes are refused.
- Cloud metadata addresses (169.254.0.0/16, `fe80::/10`, `metadata.google.internal`) are refused even with `*`, unless listed by name.
- Redirects aren't followed.
- The `file` template tag is off, so a template can't read the container's files into a request.
- Only the tools that read and send are offered: listing and reading workspaces, requests, responses, environments and auth, choosing the active environment, and sending HTTP and gRPC requests.

Keep the token secret and serve it over TLS (a reverse proxy or ingress) when it leaves a private network.

## Not yet

- OAuth 2 flows that need a browser (authorization code, implicit) can't run here; client credentials and password grants can.
- Collections are loaded at start, from files. Loading a Git Sync repository, and tools that edit, are planned.
- The image is linux/amd64 only, until libcurl is built for arm64.

## Develop

`npm run build` here (or `npm run build:server` in `packages/insomnia`) bundles `packages/insomnia/src/server` into `dist/`. `npm run smoke` runs `test/smoke.mjs` against the bundle; `node test/smoke.mjs --image <tag>` runs it against an image.
