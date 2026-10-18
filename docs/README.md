# Insomnium documentation

Insomnium is a local API client for HTTP, GraphQL, gRPC, WebSocket and Server-Sent Events. It has no account and no telemetry, and your data stays on your computer unless you sync it to a Git repository of your own.

- [Getting started](getting-started.md): collections, requests, environments and responses.
- [Template tags](template-tags.md): `{{ variables }}` and `{% tags %}` for timestamps, hashes, signatures, fake data, other responses and more.
- [Scripts](scripts.md): pre-request and after-response JavaScript, with the `insomnia` (or `pm`) API.
- [Tests and the runner](testing.md): assertions, script tests, running a collection or folder, and running it in CI.
- [Git Sync](git-sync.md): keep a collection in a Git repository, with branches, commits, pulls and pushes.
- [Import and export](import-export.md): bring collections from Postman, Insomnia, Bruno and others, and export your own.
- [Design documents](design-documents.md): edit and lint OpenAPI specs, and generate requests from them.
- [Plugins](plugins.md): add template tags, request hooks, actions and themes.
- [Keyboard shortcuts](keyboard-shortcuts.md).

Also:

- [Install with APT](apt-repository.md) on Debian and Ubuntu; other downloads are on the [releases page](https://github.com/yokomohoyo/insomnium/releases).
- [The MCP automation server](../README.md#mcp-automation-server), which lets AI clients list and send your requests. [insomnium-server](../packages/insomnium-server/README.md) runs the same tools, and the collection runner, without the app.
- [Saved credentials](../README.md#saved-credentials): what is encrypted at rest, and how.

Something missing or wrong? [Open an issue](https://github.com/yokomohoyo/insomnium/issues).
