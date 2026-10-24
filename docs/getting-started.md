# Getting started

## Collections and documents

Insomnium opens in **My Collection**, a collection of requests. The dashboard (the home button, top left) lists your collections and design documents, grouped into projects.

- A **collection** holds requests, folders and environments.
- A **design document** holds an OpenAPI spec as well: see [Design documents](design-documents.md).

Both have [unit tests](testing.md#unit-tests) in their **Test** tab, and either can become the other from its menu: **Convert to Design Document** or **Convert to Collection**.

Create either from the dashboard, or bring one in with [Import](import-export.md) or [Git Clone](git-sync.md#clone-a-repository).

## Requests

Add a request from the **+** button above the sidebar. A request can be HTTP, GraphQL, gRPC, WebSocket, an Event Stream (Server-Sent Events) or MCP. A gRPC response's **Metadata** tab shows the headers and trailers the server sent. A WebSocket request keeps messages to send again: **Save Message** saves the one in the editor with the request, and **Saved messages** puts one back. To send a binary frame, choose **Hex (binary)** or **Base64 (binary)** from the message editor's mode menu (where **JSON** is) and write the bytes: hex may be spaced or split by `:` and have `0x` before each byte, as copied from a dump. A binary frame in the event log shows its size and first bytes; open it for a hex dump (**Preview**), base64 (**Source**) or the bytes as text (**Raw**), and save it as the bytes themselves. To reconnect when a connection drops, turn on **Reconnect when the connection drops** in the request's settings, with the seconds between attempts and how many in a row. It opens again into the same response, so the event log carries on. It stops after that many attempts, unless a connection stays open for 10 seconds, which starts the count again. It never reconnects after you disconnect, or when the server answers with HTTP (such as 401) instead of a WebSocket. Disconnect while it's waiting to stop it. Its **GraphQL** tab runs a GraphQL subscription: turn on **Subscribe when connected**, write the subscription and its variables, and **Connect**. It speaks the graphql-transport-ws protocol (Apollo, Hasura, GraphQL Yoga and others), each event comes in as a message, and the connection closes when the subscription completes. Its **Socket.IO** tab makes it a Socket.IO client (v3 and v4): turn on **Use Socket.IO**, give the server's address (such as `http://localhost:3000`), a namespace and any auth (JSON), and **Connect**. The message editor then sends an event: name it in **Event**, and the JSON is its arguments (an array is the arguments). The server's events, and its heartbeats, show in the event log. Its **MQTT** tab makes it an MQTT 3.1.1 client, over a broker's WebSocket listener (such as `ws://localhost:8080` for Mosquitto's, or `ws://broker.hivemq.com:8000/mqtt`): turn on **Use MQTT**, give a client ID (or leave it for a new one each time), a user name and password if the broker wants them, and the topics to subscribe to, a line each with its QoS after it (`sensors/+/temperature 1`). **Connect** connects and subscribes; the message editor then publishes to the **Topic** by it, at QoS 0 or 1, retained if you like. Deliveries show in the event log as `topic: payload`, and QoS 1 ones are acknowledged. MQTT over plain TCP (port 1883) and MQTT 5 aren't supported yet.

Each request you open gets a tab above the request and response, to switch back to it; close one with its **×**, or with a middle click. The tabs stay open, on this computer, when you come back to the collection.

An HTTP request's tabs:

- **Body**: JSON, XML, form, multipart, a file, GraphQL, or none.
- **Auth**: Basic, Digest, Bearer, API key, OAuth 1 and 2, AWS IAM, Hawk, NTLM, Atlassian ASAP, Netrc, Google Cloud ID tokens, a JWT signed on each send, and Akamai EdgeGrid. Several can be stacked on one request.
  - **JWT** signs a token from your claims (JSON, with variables) with a secret (HS256 to HS512, optionally Base64) or a private key (RS, PS and ES), sets `iat` and an `exp` from a lifetime unless the claims have them, and sends it as `Authorization: Bearer …` or as a query parameter.
  - **Akamai EdgeGrid** signs each request (EG1-HMAC-SHA256) with an API client's client token, client secret and access token, over its method, URL, the headers you choose, and a POST's body.
- **Query** and **Headers**.
- **Assertions**: checks on the response: see [Tests and the runner](testing.md).
- **Scripts**: JavaScript run before the request and after its response: see [Scripts](scripts.md).
- **Examples**: responses the request should give. Save one from a response with **Save as Example**, in the response's history menu (Ctrl+Shift+H), or write one. Unlike the response history, examples are part of the collection, so they're exported and synced with it. The [mock server](mock-server.md) answers with them.
- **Docs**: a description, in Markdown.

`:name` segments in a URL are path parameters, filled in below the query parameters. Request settings (the request's dropdown, then **Settings**) cover redirects, URL encoding, cookies, a timeout, certificate validation and the HTTP version for that request.

Send with **Send** or Ctrl+Enter (⌘+Enter on macOS). The response pane shows the body, headers, cookies, the timeline (the raw exchange), and **Tests**, which lists the results of the request's assertions and script tests, and what its scripts logged.

Hover the response time to see how it was spent: the DNS lookup, connecting, the TLS handshake, waiting for the first byte, and the download.

**Console**, in the bar at the bottom, lists every request sent this session, from any collection or the runner: when, the method, the status, the name and URL, how its assertions went, the time and the size. Click one to see what its scripts logged, or why it failed. **Filter** narrows the list, and **Clear** empties it; it isn't kept after the app closes.

### MCP requests

An **MCP Request** tries out an MCP (Model Context Protocol) server, as an agent would use it. Choose **HTTP** and enter the server's URL, with any headers it needs (such as an `Authorization` header), or **STDIO** and the command that starts the server, with its arguments one per line. Then **Connect**.

- The response pane lists the server's **Tools**, **Prompts** and **Resources**, and its instructions.
- Choose a tool, fill in its arguments as JSON (they start from the tool's input schema, and variables and tags work), and **Call** it. The same goes for a prompt (**Get**) and a resource (**Read**).
- The arguments you last used for each tool and prompt are kept with the request.
- Over HTTP, Insomnium tries streamable HTTP first, then the older SSE transport.
- A STDIO command runs on your computer, so Insomnium shows it and asks before each run. It runs with your PATH and home folder, but not the app's other environment variables.

### OAuth 2.0

OAuth 2.0 auth gets a token with the authorization code (with PKCE if you like), implicit, password, client credentials, device code, JWT bearer or token exchange grant, keeps it with the request, and refreshes it when it expires.

- **Device Code** (RFC 8628) is for signing in on another device, as a TV or a CLI does. Give the **Device Authorization URL** and the access token URL. Insomnium shows the code to enter and the page to enter it on (**Open the Page** opens it, with the code in when the provider allows), then asks for the token every few seconds until you've signed in. Close the dialog to stop.
- **JWT Bearer** (RFC 7523) sends a signed JWT for the grant itself, as Google's service accounts and Salesforce's JWT flow use. Paste an **Assertion** to send as it is, or give a **Private Key** and Insomnium signs one: from the **Issuer** (the client ID when empty), about the **Subject** (the issuer when empty), for the access token URL (or the **Audience**), with the scope as a claim too.
- **Token Exchange** (RFC 8693) trades one token for another: the **Subject Token** and its type, and optionally an **Actor Token** (who acts on the subject's behalf), the **Requested Token Type**, audience, resource and scope. A `{% response %}` tag can take the subject token from another request's sign-in.
- For these three, the client ID and secret are sent only when given (a public client sends just its ID).

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

A single variable can be **Secret** instead (the column in the table, in a collection's and the global environments): its value is masked, kept on this computer only, and encrypted with your system keychain, like saved credentials. The environment keeps its name with an empty value, so exports and Git Sync share the name and not the value, and each teammate fills in their own. Requests, scripts and template tags get the value as usual. The JSON view shows a secret as `""`: edit it in the table, or type a new value there, which is kept as the secret. A script, the MCP server's `update_environment` and insomnium-server's `INSOMNIUM_VAR_<name>` set a secret's value the same way.

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
