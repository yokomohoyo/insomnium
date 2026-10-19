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

## Serve a Git Sync repository

Instead of an export, give the repository a collection is synced to with Git Sync, and the server keeps up with it: every `--pull-interval` (5 minutes by default) it fetches what was pushed and applies it. Requests and folders that were added or changed are written, ones deleted upstream go, and the rest keep the responses they've had. It only ever reads the repository.

```sh
docker run -p 8080:8080 \
  -e INSOMNIUM_MCP_TOKEN="$TOKEN" \
  -e INSOMNIUM_ALLOWED_HOSTS="api.internal.example.com" \
  -e INSOMNIUM_GIT_TOKEN="$GITHUB_TOKEN" \
  ghcr.io/yokomohoyo/insomnium-server --repo https://github.com/acme/api-collection.git --branch main --env staging
```

`--repo` takes:

- **An http(s) URL**, which the server clones. For a private repository, set `INSOMNIUM_GIT_TOKEN` to a token that can read it (a GitHub fine-grained token with read-only Contents, say), and `INSOMNIUM_GIT_USERNAME` if the host needs a particular username. SSH remotes can't be cloned; mount a checkout instead.
- **A directory** with a checkout of the repository, kept current by something else: a mounted volume, a sidecar that pulls, a CI checkout. The server reads it again every `--pull-interval`.

The repository's `.insomnium` folder (or `.insomnia`, from Insomnia) is read the way the app reads a clone, so it holds one workspace. `INSOMNIUM_VAR_*` values apply over the repository's environment after every update. `run`, `load` and `mock` take `--repo` too, and read the repository once.

## Options

| | |
|---|---|
| `--collection <file>` | A collection to load; repeat for more. |
| `--repo <url or directory>` | A Git Sync repository to serve (see above); repeat for more. |
| `--branch <name>` | The branch of the repositories to clone; the remote's default otherwise. |
| `--pull-interval <seconds>` | How often to update the repositories (`INSOMNIUM_PULL_INTERVAL`, default 300); 0 for never. |
| `--env <name>` | The sub environment to send with. |
| `--host`, `--port` | Where to listen (`INSOMNIUM_HOST`, `INSOMNIUM_PORT`; the image uses `0.0.0.0:8080`). |
| `INSOMNIUM_MCP_TOKEN` | **Required**, 32+ characters. Clients send it as a bearer token. |
| `INSOMNIUM_ALLOWED_HOSTS` | **Required**. Comma-separated hosts requests may go to: `api.example.com`, `*.example.com` (subdomains), `10.0.0.5`, or `*` for any. |
| `INSOMNIUM_VAR_<name>` | Sets `<name>` in the chosen environment (or the base one), so secrets come from the deployment rather than the collection file. |
| `INSOMNIUM_VALIDATE_SSL` | `false` to skip certificate validation. |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | The proxy to send through, read as curl reads them. gRPC can only use an `http://` proxy. |
| `INSOMNIUM_ALLOWED_ENV` | Comma-separated environment variables that collections may read with `{% env 'NAME' %}`: names, or prefixes ending in `*`. None by default, so a collection can't read the container's environment unless you allow it. |
| `INSOMNIUM_ALLOWED_SECRETS` | The secret-manager secrets the [secret tags](../../docs/template-tags.md#secrets-from-a-secret-manager) may read, such as `vault:secret/data/app` or `aws:prod/*`. None by default. |
| `INSOMNIUM_GIT_TOKEN`, `INSOMNIUM_GIT_USERNAME` | A token for cloning private repositories (sent as the password), and the username to send with it. |

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
| `--repo <url or directory>`, `--branch <name>` | A Git Sync repository to run, [as serve takes it](#serve-a-git-sync-repository). |
| `--folder <name>` | Only that folder's requests: its name, or its path (`Users/Admin`) when the name isn't unique. |
| `--env <name>` | The sub environment to send with. |
| `--data <file>` | A CSV file with a header row, or a JSON array of objects: one row of variables per iteration, over the environment's. |
| `--iterations <n>` | How many times to run the requests. Defaults to 1, or once per data row; rows repeat when there are fewer. |
| `--delay <ms>` | Wait between requests. |
| `--bail` | Stop at the first request that fails. |
| `--junit <file>` | Write a JUnit XML report: a suite per request, a case per assertion. |
| `--json <file>` | Write the results as JSON. |

`INSOMNIUM_VAR_<name>`, `INSOMNIUM_VALIDATE_SSL`, `INSOMNIUM_ALLOWED_ENV` and the proxy variables work as they do for the server. `INSOMNIUM_ALLOWED_HOSTS` is optional here: a run sends to any host by default, but still refuses cloud metadata addresses unless they're listed. The `file` template tag is off here too.

## Load test a collection

`load` load tests a collection's HTTP requests: each virtual user sends them in order, again and again, until the time is up, as the app's runner does in **Load test** mode. It prints the latency percentiles, throughput and failures, and exits 1 when a threshold is broken (2 when the test can't start). A request fails when it can't be sent, answers 400 or above, or fails an assertion. Responses aren't kept.

```sh
docker run --rm -e INSOMNIUM_VAR_apiKey="$API_KEY" -v "$PWD:/work" -w /work \
  ghcr.io/yokomohoyo/insomnium-server load --collection api.yaml --env staging \
  --users 20 --duration 1m --ramp-up 10s --max-p95 300 --max-errors 1
```

```
Request      Sent   Failed      Mean       p50       p90       p95       p99       Max
List pets    4212        0   41.2 ms     38 ms     55 ms     63 ms     91 ms    240 ms
Get pet      4207        3   12.9 ms     11 ms     18 ms     22 ms     40 ms    185 ms
All          8419        3     27 ms     19 ms     49 ms     56 ms     82 ms    240 ms

8419 requests in 60.0 s from 20 users · 140.3/s · 3 failed (0.04%)
Status codes: 200 × 8416, 503 × 3
  ✗ 3 × HTTP 503
```

| | |
|---|---|
| `--collection <file>` | A collection to load test, in any format Import takes; repeat for more. |
| `--repo <url or directory>`, `--branch <name>` | A Git Sync repository to load test, [as serve takes it](#serve-a-git-sync-repository). |
| `--folder <name>` | Only that folder's requests: its name, or its path. |
| `--env <name>` | The sub environment to send with. |
| `--users <n>` | Virtual users, 1 to 100 (default 5). |
| `--duration <time>` | How long: `30s`, `2m`, `500ms` (default 30s, at most 60m). |
| `--ramp-up <time>` | Start the users one after another over this long. |
| `--think-time <time>` | Each user's wait after each request. |
| `--max-p95 <ms>` | Fail when the 95th percentile latency is over this. |
| `--max-p99 <ms>` | Fail when the 99th percentile latency is over this. |
| `--max-errors <percent>` | Fail when more than this percentage of requests fail, such as `1` or `0.5`. |
| `--json <file>` | Write the results as JSON. |

The environment variables work as they do for `run`. Ctrl+C stops the test early and still prints the results. Load test only APIs you're allowed to.

## Mock a collection

`mock` answers as a collection's requests would, with their examples (saved responses), for a front end or tests to call instead of the real API. See the [mock server docs](../../docs/mock-server.md) for how it matches.

```sh
docker run --rm -p 4040:4040 -v "$PWD:/work" -w /work \
  ghcr.io/yokomohoyo/insomnium-server mock --collection api.yaml --host 0.0.0.0
```

| | |
|---|---|
| `--collection <file>` | A collection to answer for, in any format Import takes; repeat for more. |
| `--repo <url or directory>`, `--branch <name>` | A Git Sync repository to answer for, [as serve takes it](#serve-a-git-sync-repository). |
| `--port <n>` | The port (`INSOMNIUM_MOCK_PORT`; default 4040). |
| `--host <address>` | The address to listen on (`INSOMNIUM_MOCK_HOST`; default 127.0.0.1, so use 0.0.0.0 in a container). |

## Not yet

- OAuth 2 flows that need a browser (authorization code, implicit) can't run here; client credentials and password grants can.
- Tools that edit, and writing back to a repository, are planned.
- Repositories are cloned over http(s) only; for SSH, mount a checkout.
- The image is linux/amd64 only, until libcurl is built for arm64.

## Develop

`npm run build` here (or `npm run build:server` in `packages/insomnia`) bundles `packages/insomnia/src/server` into `dist/`. `npm run smoke` runs `test/smoke.mjs` against the bundle; `node test/smoke.mjs --image <tag>` runs it against an image.
