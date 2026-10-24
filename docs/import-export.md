# Import and export

## Import

Import from a collection's menu (the collection's name, top left), or from **Preferences → Data**. Choose a file, a URL or the clipboard, then **Scan**: Insomnium works out the format, and shows what it found before you **Import**.

Imported into a collection you already have, the requests and folders are added to it, and so are the imported collection's variables (its base environment) that yours doesn't have; a variable you've already set keeps its value.

| Format | Notes |
|---|---|
| **Postman** collections, v2.0 and v2.1 | Folders, auth (including auth inherited from a folder or the collection), path variables, bodies and collection variables. Saved responses become [examples](getting-started.md#requests). Scripts become [request scripts](scripts.md): see below. `{{$randomEmail}}`-style dynamic variables become [Faker tags](template-tags.md). |
| **Postman** environments and globals | An environment's values become a sub environment. Globals are added to the project's [global environment](getting-started.md#global-environments). |
| **Insomnia v5** (YAML), from Insomnia 11 and later | Folders, requests, gRPC and WebSocket requests, environments, the cookie jar, the API spec, unit tests, and scripts. Socket.IO requests, MCP clients and mock servers have no counterpart in Insomnium, so they're left out. |
| **Insomnium and Insomnia v1 to v4** (JSON or YAML) | Insomnium's own export format, and Insomnia's before v5. |
| **Bruno** collection and environment exports (JSON) | Folders, requests, auth, headers, variables, environments and assertions, which become [assertions](testing.md#assertions). Bruno's scripts and tests use its own API, so they're kept as text in the request's description. `{{process.env.NAME}}` becomes the [`env` tag](template-tags.md#os-environment-variables-and-dotenv). |
| **Hoppscotch** v2 collections | |
| **OpenAPI 3.0** and **Swagger 2.0** | A request for each operation. Import into a [design document](design-documents.md) to keep the spec too. |
| **HAR 1.2** | Requests from a browser's network log. |
| **cURL** | A `curl` command. Pasting one into a request's URL bar offers to turn that request into it. |
| **WSDL** | A request for each SOAP operation. |

### Scripts

Postman's pre-request and test scripts, and Insomnia's pre-request and after-response scripts, become the requests' own [scripts](scripts.md). Those apps also run a collection's and its folders' scripts before each request's, so those are copied into each request under them, in order, each in a function of its own:

```js
// from Postman collection "Shop"
await (async () => {
pm.environment.set('ts', Date.now());
})();

// from this request
await (async () => {
pm.test('ok', () => pm.response.to.have.status(200));
})();
```

The folder keeps the original as text in its description. Postman scripts that are disabled stay as text in the description too.

### Import links

A link like `insomnia://app/import?uri=https://example.com/api.yaml` opens Insomnium and offers to import from that URL, so "Run in Insomnia" buttons work with Insomnium too.

## Capture traffic

**Capture Traffic…**, in a collection's menu, records the requests an app, a script or a browser sends, to keep as requests. It starts a proxy on this computer (port 8899, or one you choose); point what you want to capture at it, such as `HTTP_PROXY=http://127.0.0.1:8899 npm test` or `curl -x http://127.0.0.1:8899 http://…`. Each request sent through it is listed with its response's status and time; **Save** keeps one in the collection, with its method, URL, headers and body, and **Save as Requests** keeps the ones you've chosen.

Plain HTTP is recorded in full. HTTPS goes through untouched and is listed by its host only: reading it would mean trusting a certificate authority of Insomnium's, which no privacy tool should ask of you. To keep HTTPS requests, save them from a browser's devtools (**Network → Save all as HAR**) and import the HAR file. The proxy listens on this computer only, keeps the latest 500 requests while the app runs, and stops with **Stop** or when the app closes.

## Export

Export a collection or document from its menu, or everything in a project from **Preferences → Data → Export Data**:

- **Insomnium v4**, as JSON or YAML: everything, for import into Insomnium or Insomnia, or for [insomnium-server](../packages/insomnium-server/README.md).
- **HAR**: the requests only.
- **Postman Collection v2.1**, for Postman or any tool that imports it: folders, requests (query, path variables, headers, bodies), auth (Basic, Bearer, API key, Digest, NTLM, OAuth 1 and 2, AWS, Hawk, JWT and EdgeGrid; an empty one inherits, as in Insomnium), scripts as Postman's pre-request and test scripts, examples as saved responses, and the base environment as collection variables. `{{ _.name }}` becomes `{{name}}`, and Faker tags become Postman's `{{$randomEmail}}` variables. Other tags have no Postman form and stay as written. gRPC and WebSocket requests, and sub environments, aren't part of a Postman collection, so they're left out.
- **OpenAPI 3.0** (YAML), an API description of the HTTP requests, for documentation and mock tools, or to start a [design document](design-documents.md) from requests you already have. Each request is an operation:
  - its method and path, with `{{ _.id }}` and `:id` as the path parameter `{id}`, and its query parameters and headers;
  - its body as the request body, with a schema worked out from a JSON example;
  - its [examples](getting-started.md#requests) as responses;
  - its folder as its tag;
  - its auth, or the folder's it inherits, as security (Basic, Digest, Bearer, API key and OAuth 2).

  Servers come from the start of the URLs: `{{ _.base_url }}` is the base environment's `base_url`, and each sub environment's, when they're set. Variables and tags in values aren't examples, so they're left out. A second request for the same method and path, such as a variant of the first, is left out too, as are gRPC and WebSocket requests.

- **TypeScript client**: a client for the API, in one `.ts` file with no dependencies, for an app or a test suite to call it with. It's made from a design document's OpenAPI 3 spec, or from the requests (as for the OpenAPI export) when there's no spec. Each schema is a type and each operation a function, taking its path, query and header parameters and its body, and answering with its response's type:

  ```ts
  import { createClient } from './pet-store.client';

  const api = createClient({ headers: { Authorization: `Bearer ${token}` } });
  const pets = await api.listPets({ limit: 10 });
  ```

  The base URL is the spec's first server, unless you give `baseUrl`. A response that isn't 2xx throws an `ApiError` with its status and body. It runs wherever `fetch` does: browsers, Node 18 and later, Deno and Bun.

- **API documentation**, as one Markdown file (for a repo's `docs/` or a wiki) or as one HTML page (to host anywhere, or open from disk). Like the TypeScript client, it's made from a design document's OpenAPI 3 spec, or from the requests when there's no spec: then each folder is a section, its description and the requests' descriptions are the text, and [examples](getting-started.md#requests) are the responses. It has:
  - the servers and the kinds of auth;
  - a section for each tag (folder), each operation with its method and path, description, auth, parameters, request body and responses;
  - each body's fields and an example: the spec's own, or one made from the schema;
  - the schemas, with their fields and their JSON Schema.

  The HTML page loads nothing: its styles are inline, it follows the reader's light or dark setting, and it works on a phone. Descriptions are Markdown. In the page, any HTML in them shows as text, and only `http(s)`, `mailto` and in-page links are kept, so a spec can't put script in it.

Insomnium asks whether to include private environments. The MCP tool `export_workspace` can also export a collection, with `format` `insomnium`, `postman`, `openapi`, `markdown` or `html`.

To share a collection with a team as it changes, use [Git Sync](git-sync.md) instead.

## Add a format

Importers live in [`packages/insomnia/src/utils/importers/importers`](../packages/insomnia/src/utils/importers/importers). Each turns a file's text into Insomnium's resources, and has fixtures (an input and the expected output) that the tests check. Pull requests for more formats are welcome.
