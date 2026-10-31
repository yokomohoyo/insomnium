# Insomnium documentation

Insomnium is a local API client for HTTP, GraphQL, gRPC, WebSocket and Server-Sent Events. It has no account and no telemetry, and your data stays on your computer unless you sync it to a Git repository of your own.

- [Getting started](getting-started.md): collections, requests, environments and responses.

Each kind of request:

- [GraphQL](graphql.md): queries and mutations with completion from the server's schema, variables, and subscriptions.
- [gRPC](grpc.md): all four kinds of call, from `.proto` files or server reflection, with metadata, TLS and streaming.
- [WebSocket, Socket.IO and MQTT](websockets.md): live connections, text and binary messages, saved messages and reconnecting.
- [Event streams](event-streams.md): Server-Sent Events, as they arrive.
- [MCP requests](mcp-requests.md): connect to an MCP server and call its tools, prompts and resources.

Working with them:

- [Template tags](template-tags.md): `{{ variables }}` and `{% tags %}` for timestamps, hashes, signatures, fake data, other responses and more.
- [Scripts](scripts.md): pre-request and after-response JavaScript, with the `insomnia` (or `pm`) API.
- [Tests and the runner](testing.md): assertions, script tests, running a collection or folder, and running it in CI.
- [Flows](flows.md): requests in an order you draw, with conditions on their responses, variables from them, and delays.
- [Mock server](mock-server.md): answer as a collection's requests would, with their examples.
- [Git Sync](git-sync.md): keep a collection in a Git repository, with branches, commits, pulls and pushes.
- [Team server](team-server.md): share collections from a server on your own network, with accounts, roles and single sign-on.
- [Team server single sign-on](team-server-sso.md): sign in to a team server through Synology SSO Server, Authentik, Keycloak or Google.
- [Your editor](editors.md): requests as files with completion, and your editor's AI agent sending them.
- [Folder Sync](folder-sync.md): keep a collection in a folder of readable YAML files, a file per request, to edit and review like code.
- [Import and export](import-export.md): bring collections from Postman, Insomnia, Bruno and others, and export your own.
- [Design documents](design-documents.md): edit and lint OpenAPI specs, and generate requests from them.
- [Plugins](plugins.md): add template tags, request hooks, actions and themes.
- [AI assistant](ai-assistant.md): write a request from a description, or a commit message, with a model you choose, on your computer or with your own key.
- [Keyboard shortcuts](keyboard-shortcuts.md).
- [Translating](translating.md): the languages the app comes in, and how to improve one or add one.

Also:

- [Install with APT](apt-repository.md) on Debian and Ubuntu; other downloads are on the [releases page](https://github.com/yokomohoyo/insomnium/releases).
- [The MCP automation server](mcp-server.md), which lets AI assistants and coding agents find, send, run and change your requests, and `insomnium-cli`, which does the same from a terminal. [insomnium-server](../packages/insomnium-server/README.md) runs the read and send tools, and the collection runner, without the app.
- [Saved credentials](../README.md#saved-credentials): what is encrypted at rest, and how.

Something missing or wrong? [Open an issue](https://github.com/yokomohoyo/insomnium/issues).
