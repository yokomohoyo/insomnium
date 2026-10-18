# Getting started

## Collections and documents

Insomnium opens in **My Collection**, a collection of requests. The dashboard (the home button, top left) lists your collections and design documents, grouped into projects.

- A **collection** holds requests, folders and environments.
- A **design document** holds an OpenAPI spec as well, with its own requests and tests: see [Design documents](design-documents.md).

Create either from the dashboard, or bring one in with [Import](import-export.md) or [Git Clone](git-sync.md#clone-a-repository).

## Requests

Add a request from the **+** button above the sidebar. A request can be HTTP, GraphQL, gRPC, WebSocket or an Event Stream (Server-Sent Events). A gRPC response's **Metadata** tab shows the headers and trailers the server sent.

An HTTP request's tabs:

- **Body**: JSON, XML, form, multipart, a file, GraphQL, or none.
- **Auth**: Basic, Digest, Bearer, API key, OAuth 1 and 2, AWS IAM, Hawk, NTLM, Atlassian ASAP, Netrc and Google Cloud ID tokens. Several can be stacked on one request.
- **Query** and **Headers**.
- **Assertions**: checks on the response: see [Tests and the runner](testing.md).
- **Scripts**: JavaScript run before the request and after its response: see [Scripts](scripts.md).
- **Docs**: a description, in Markdown.

`:name` segments in a URL are path parameters, filled in below the query parameters. Request settings (the request's dropdown, then **Settings**) cover redirects, URL encoding, cookies, a timeout, certificate validation and the HTTP version for that request.

Send with **Send** or Ctrl+Enter (⌘+Enter on macOS). The response pane shows the body, headers, cookies, the timeline (the raw exchange), and **Tests**, which lists the results of the request's assertions and script tests, and what its scripts logged.

Hover the response time to see how it was spent: the DNS lookup, connecting, the TLS handshake, waiting for the first byte, and the download.

## Folders

Folders group requests. A folder can also have:

- **Auth and headers** that every request in it inherits. A request whose auth is left empty uses its folder's, and one whose auth is set to **None** sends none. A request's own header replaces a folder header of the same name. Folders take any auth but OAuth 2, which keeps its tokens per request.
- **An environment**, whose values apply to the requests in it, over the collection's.

Open them from the folder's dropdown, under **Settings**.

## Environments

An environment is a set of variables, as JSON. Every collection has a **base environment**. Its **sub environments** (Staging, Production…) add to it or override it, and you switch between them in the sidebar, above the requests.

The environment editor shows the variables as a **Table** (a row for each, with its name, value, and whether it is text or JSON) or as **JSON**, which can hold nested values. Use a variable anywhere in a request as `{{ name }}`; with nested values, `{{ api.host }}`. Mark a sub environment **private** to keep it out of exports and Git Sync, for example one holding your own tokens.

See [Template tags](template-tags.md) for values that are computed when a request is sent.

### Global environments

**Globals**, in the sidebar, edits the project's global environments: variables for every collection in the project, such as a shared token or a region. A collection's own environments override them.

Like a collection's, they have a base environment and sub environments. Each collection chooses which global sub environment it uses, if any, with **Use in This Collection**. Global environments aren't part of a collection, so its exports and Git Sync leave them out. Postman's globals are imported into them.

From the lowest to the highest, a request's variables come from: the global base environment, the global sub environment in use, the collection's base environment, its sub environment, its folders, and then the [runner](testing.md)'s data row and the variables its [pre-request script](scripts.md) set.

## History

**History**, in the sidebar, lists the latest responses from every collection, newest first. Filter them by request, URL, folder or collection, and open one to see it with its request. A request's own past responses are in the response pane's history menu.

## Cookies

Each collection has a cookie jar. Responses' `Set-Cookie` headers go into it, and matching cookies are sent with later requests. **Cookies** in the sidebar edits it, and a request's settings can turn sending or storing them off.

## Preferences

Preferences (Ctrl+, or ⌘+,) cover the theme, fonts, the global request timeout, proxy, certificate validation, the OS environment variables templates may read, plugins, data import and export, keyboard shortcuts, and snapshots.

A **proxy** can be set there (HTTP, HTTPS and a no-proxy list), or Insomnium can use the system's proxy settings. HTTP, gRPC and WebSocket requests all use it.

A collection's settings take a CA certificate, which is added to the usual trusted roots, and client certificates by host. Preferences can also trust the operating system's certificate store.

## Snapshots

While it runs, Insomnium copies all your data once a day and keeps the last seven. If you delete a collection by mistake, or an import goes wrong, restore a snapshot from **Preferences → Data**. Restoring one replaces everything with that copy: Insomnium restarts to do it. The copies stay on your computer.
