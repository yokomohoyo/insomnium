# GraphQL

A **GraphQL Request** sends queries and mutations, with completion, checking and documentation from the server's schema. Subscriptions run over a WebSocket: see [below](#subscriptions).

## Write a query

Add one with the **+** button above the sidebar, choosing **GraphQL Request**. It shows as **GQL** in the sidebar. It's an HTTP POST with a **GraphQL Query** body, so auth, headers, query parameters, [scripts](scripts.md), [assertions](testing.md), examples and settings all work as for any HTTP request. (Any HTTP request can switch its body to **GraphQL Query** too; that makes it a POST.)

The body has two editors:

- **The query.** Once the schema is loaded, it completes fields and arguments, shows a field's type and description when you hover over it, and underlines mistakes. Click a type or field to open it in the documentation. When the document has more than one named operation, pick the one to send from **Operations**. **Prettify GraphQL** (Ctrl+Shift+F, ⌘+Shift+F on macOS) tidies it up.
- **Query Variables**, as JSON. It completes the variables the operation declares and checks their types. Variables and template tags work here, such as `{{ userId }}`.

Send with **Send** or Ctrl+Enter (⌘+Enter on macOS).

## The schema

Insomnium fetches the schema by introspection from the request's URL, with the request's own headers and auth, so a server that needs a token gets it.

The **schema** menu, above the query:

- **Show Documentation** opens a documentation explorer of the schema's types and fields, with **Search the docs...**. Ctrl+Shift+I (⌘+Shift+I) jumps to its search.
- **Refresh Schema** fetches it again.
- **Automatic Fetch** fetches it again when the URL, the request or the environment changes. It's on to start with, and the setting applies to every GraphQL request; turn it off for a server that's slow to introspect or shouldn't be asked. The introspection request runs the request's assertions and after-response script too.
- **Load schema from JSON** reads an introspection result from a file instead, for a server with introspection turned off. The file needs the result's `data` field.

Below the editor, Insomnium says when the schema was fetched, or why it couldn't be.

## Subscriptions

A subscription needs a connection that stays open, so it runs in a [WebSocket request](websockets.md#graphql-subscriptions): open its **GraphQL** tab, turn on **Subscribe when connected**, write the subscription and its variables, and **Connect**. Each event comes in as a message. Choosing a subscription in a GraphQL request says the same.

## Things to know

- Queries are sent as a JSON POST body. GraphQL over GET, persisted queries and file uploads (multipart) aren't supported.
- The [runner](testing.md), [flows](flows.md) and the [automation server](mcp-server.md)'s `send_http_request` send GraphQL requests like any HTTP request.
