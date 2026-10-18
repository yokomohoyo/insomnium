# insomnium-server

Insomnium's MCP tools without the app. It loads a collection and lets AI clients (Claude Code and other MCP clients) list its requests and send them, over MCP's Streamable HTTP transport. Run it in a container next to the APIs an agent should test: inside a cluster, a VPC, or a staging network the agent can't reach directly. It also runs a collection's requests and their assertions in CI: see [Run a collection in CI](#run-a-collection-in-ci).

It reads and sends; it can't change the collection, its environments or auth.

## Run it

Each release publishes the image, tagged with its version and `latest`:

```sh
docker pull ghcr.io/yokomohoyo/insomnium-server:latest
```

Or build it from the repository root:

```sh
docker build -f packages/insomnium-server/Dockerfile -t insomnium-server .
```

Export a collection from Insomnium (or use an Insomnia v4/v5 export, or a Postman collection), and run:

```sh
TOKEN="$(openssl rand -base64 32)"
docker run -p 8080:8080 \
  -v "$PWD/collection.yaml:/data/collection.yaml:ro" \
  -e INSOMNIUM_MCP_TOKEN="$TOKEN" \
  -e INSOMNIUM_ALLOWED_HOSTS="api.internal.example.com,*.staging.example.com" \
  -e INSOMNIUM_VAR_apiKey="$API_KEY" \
  ghcr.io/yokomohoyo/insomnium-server --collection /data/collection.yaml --env staging
```

The container runs as the `node` user (uid 1000), so the collection file has to be readable by it.

Then point an MCP client at `http://<host>:8080/mcp` with the header `Authorization: Bearer $TOKEN`. For Claude Code:

```sh
claude mcp add --transport http insomnium http://localhost:8080/mcp --header "Authorization: Bearer $TOKEN"
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
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | The proxy to send through, read as curl reads them. gRPC can only use an `http://` proxy. |
| `INSOMNIUM_ALLOWED_ENV` | Comma-separated environment variables that collections may read with `{% env 'NAME' %}`: names, or prefixes ending in `*`. None by default, so a collection can't read the container's environment unless you allow it. |

`GET /health` answers without a token, for health checks.

## What it allows

The server can reach whatever its network can, so it only sends where you say:

- Requests, and gRPC calls and reflection, go only to `INSOMNIUM_ALLOWED_HOSTS`, over http, https or gRPC. Unix sockets and other schemes are refused.
- Cloud metadata addresses (169.254.0.0/16, `fe80::/10`, `metadata.google.internal`) are refused even with `*`, unless listed by name.
- Redirects aren't followed.
- The `file` template tag is off, so a template can't read the container's files into a request.
- The `env` template tag reads only the variables `INSOMNIUM_ALLOWED_ENV` names.
- Only the tools that read and send are offered: listing and reading workspaces, requests, responses, environments and auth, choosing the active environment, and sending HTTP and gRPC requests.

Keep the token secret and serve it over TLS (a reverse proxy or ingress) when it leaves a private network.

## Run a collection in CI

`run` is the collection runner. It sends a collection's HTTP requests in order, as Send does in the app, and checks each request's assertions (the Assertions tab). It exits 1 when a request can't be sent or an assertion fails, and 2 when the run can't start. Responses are kept while it runs, so cookies and `{% response %}` tags chain from one request to the next.

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work \
  -e INSOMNIUM_VAR_apiKey="$API_KEY" \
  ghcr.io/yokomohoyo/insomnium-server run --collection api.yaml --env staging --junit report.xml
```

```
[run] Pet Store: 3 requests
  ✓ Pets / List pets  GET 200 OK  41 ms
      ✓ Status code equals 200
  ✗ Pets / Get pet  GET 200 OK  12 ms
      ✗ JSON path $.name equals Tom: got "Tim"
  ✓ Health  GET 204 No Content  3 ms

3 requests, 1 failed · 2 assertions, 1 failed · 0.1 s
```

`--user` lets the container write the report into your directory; without a report it can be left out.

| | |
|---|---|
| `--collection <file>` | A collection to run, in any format Import takes; repeat for more. |
| `--folder <name>` | Only that folder's requests: its name, or its path (`Users/Admin`) when the name isn't unique. |
| `--env <name>` | The sub environment to send with. |
| `--data <file>` | A CSV file with a header row, or a JSON array of objects: one row of variables per iteration, over the environment's. |
| `--iterations <n>` | How many times to run the requests. Defaults to 1, or once per data row; rows repeat when there are fewer. |
| `--delay <ms>` | Wait between requests. |
| `--bail` | Stop at the first request that fails. |
| `--junit <file>` | Write a JUnit XML report: a suite per request, a case per assertion. |
| `--json <file>` | Write the results as JSON. |

`INSOMNIUM_VAR_<name>`, `INSOMNIUM_VALIDATE_SSL`, `INSOMNIUM_ALLOWED_ENV` and the proxy variables work as they do for the server. `INSOMNIUM_ALLOWED_HOSTS` is optional here: a run sends to any host by default, but still refuses cloud metadata addresses unless they're listed. The `file` template tag is off here too.

## Not yet

- OAuth 2 flows that need a browser (authorization code, implicit) can't run here; client credentials and password grants can.
- Collections are loaded at start, from files. Loading a Git Sync repository, and tools that edit, are planned.
- The image is linux/amd64 only, until libcurl is built for arm64.

## Develop

`npm run build` here (or `npm run build:server` in `packages/insomnia`) bundles `packages/insomnia/src/server` into `dist/`. `npm run smoke` runs `test/smoke.mjs` against the bundle; `node test/smoke.mjs --image <tag>` runs it against an image.
