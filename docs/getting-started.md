# Getting started

## Collections and documents

Insomnium opens in **My Collection**, a collection of requests. The dashboard (the home button, top left) lists your collections and design documents, grouped into projects.

- A **collection** holds requests, folders and environments.
- A **design document** holds an OpenAPI spec as well: see [Design documents](design-documents.md).

Both have [unit tests](testing.md#unit-tests) in their **Test** tab, and either can become the other from its menu: **Convert to Design Document** or **Convert to Collection**.

Create either from the dashboard, or bring one in with [Import](import-export.md) or [Git Clone](git-sync.md#clone-a-repository).

## Requests

Add a request from the **+** button above the sidebar. A request can be HTTP, GraphQL, gRPC, WebSocket or an Event Stream (Server-Sent Events). A gRPC response's **Metadata** tab shows the headers and trailers the server sent. A WebSocket request keeps messages to send again: **Save Message** saves the one in the editor with the request, and **Saved messages** puts one back. Its **GraphQL** tab runs a GraphQL subscription: turn on **Subscribe when connected**, write the subscription and its variables, and **Connect**. It speaks the graphql-transport-ws protocol (Apollo, Hasura, GraphQL Yoga and others), each event comes in as a message, and the connection closes when the subscription completes.

Each request you open gets a tab above the request and response, to switch back to it; close one with its **×**, or with a middle click. The tabs stay open, on this computer, when you come back to the collection.

An HTTP request's tabs:

- **Body**: JSON, XML, form, multipart, a file, GraphQL, or none.
- **Auth**: Basic, Digest, Bearer, API key, OAuth 1 and 2, AWS IAM, Hawk, NTLM, Atlassian ASAP, Netrc and Google Cloud ID tokens. Several can be stacked on one request.
- **Query** and **Headers**.
- **Assertions**: checks on the response: see [Tests and the runner](testing.md).
- **Scripts**: JavaScript run before the request and after its response: see [Scripts](scripts.md).
- **Examples**: responses the request should give. Save one from a response with **Save as Example**, in the response's history menu (Ctrl+Shift+H), or write one. Unlike the response history, examples are part of the collection, so they're exported and synced with it. The [mock server](mock-server.md) answers with them.
- **Docs**: a description, in Markdown.

`:name` segments in a URL are path parameters, filled in below the query parameters. Request settings (the request's dropdown, then **Settings**) cover redirects, URL encoding, cookies, a timeout, certificate validation and the HTTP version for that request.

Send with **Send** or Ctrl+Enter (⌘+Enter on macOS). The response pane shows the body, headers, cookies, the timeline (the raw exchange), and **Tests**, which lists the results of the request's assertions and script tests, and what its scripts logged.

Hover the response time to see how it was spent: the DNS lookup, connecting, the TLS handshake, waiting for the first byte, and the download.

### OAuth 2.0

OAuth 2.0 auth gets a token with the authorization code (with PKCE if you like), implicit, password or client credentials grant, keeps it with the request, and refreshes it when it expires.

- **Use the System Browser** (authorization code) signs in with your browser instead of a window of the app. That's for providers that block embedded windows, and for single sign-on and passkeys that live in your browser. The redirect URL has to be a loopback address the provider allows, such as `http://127.0.0.1:8484/callback`; leave out the port and any free one is used. Insomnium checks that the sign-in comes back with the state it sent.
- **Client Assertion (private_key_jwt)**, under the advanced options, authenticates the client with a short-lived JWT signed with its private key (RS256 to ES512), instead of the client secret. Give the PEM private key, and the key ID if the provider needs it.

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

## Cookies

Each collection has a cookie jar. Responses' `Set-Cookie` headers go into it, and matching cookies are sent with later requests. **Cookies** in the sidebar edits it, and a request's settings can turn sending or storing them off.

## Preferences

Preferences (Ctrl+, or ⌘+,) cover the theme, fonts, the global request timeout, proxy, certificate validation, the OS environment variables templates may read, plugins, data import and export, keyboard shortcuts, and snapshots.

A **proxy** can be set there (HTTP, HTTPS and a no-proxy list), or Insomnium can use the system's proxy settings. HTTP, gRPC and WebSocket requests all use it.

A collection's settings take a CA certificate, which is added to the usual trusted roots, and client certificates by host. Preferences can also trust the operating system's certificate store.

## Snapshots

While it runs, Insomnium copies all your data once a day and keeps the last seven. If you delete a collection by mistake, or an import goes wrong, restore a snapshot from **Preferences → Data**. Restoring one replaces everything with that copy: Insomnium restarts to do it. The copies stay on your computer.
