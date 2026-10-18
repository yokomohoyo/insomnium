# Import and export

## Import

Import from a collection's menu (the collection's name, top left), or from **Preferences → Data**. Choose a file, a URL or the clipboard, then **Scan**: Insomnium works out the format, and shows what it found before you **Import**.

| Format | Notes |
|---|---|
| **Postman** collections, v2.0 and v2.1 | Folders, auth (including auth inherited from a folder or the collection), path variables, bodies and collection variables. Scripts become [request scripts](scripts.md): see below. `{{$randomEmail}}`-style dynamic variables become [Faker tags](template-tags.md). |
| **Postman** environments | Their values become an environment. |
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

## Export

Export a collection or document from its menu, or everything in a project from **Preferences → Data → Export Data**:

- **Insomnium v4**, as JSON or YAML: everything, for import into Insomnium or Insomnia, or for [insomnium-server](../packages/insomnium-server/README.md).
- **HAR**: the requests only.

Insomnium asks whether to include private environments.

To share a collection with a team as it changes, use [Git Sync](git-sync.md) instead.

## Add a format

Importers live in [`packages/insomnia/src/utils/importers/importers`](../packages/insomnia/src/utils/importers/importers). Each turns a file's text into Insomnium's resources, and has fixtures (an input and the expected output) that the tests check. Pull requests for more formats are welcome.
