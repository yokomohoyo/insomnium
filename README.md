# Insomnium API Client

Insomnium is a 100% local and privacy-focused open-source API client for testing GraphQL, REST, WebSockets, Server-sent events and gRPC in development/production.

- ✅ works 100% offline, the way a local testing tool should behave <br>
- ✅ no cloud services, no tracking/communication to external servers behind the scene <br>

[![license](https://img.shields.io/github/license/yokomohoyo/insomnium.svg)](LICENSE)
[![GitHub Discussions](https://img.shields.io/github/discussions/yokomohoyo/insomnium)](https://github.com/yokomohoyo/insomnium/discussions)

![Insomnium API Client](https://raw.githubusercontent.com/yokomohoyo/insomnium/main/screenshots/v0.1.png)

## Current Status

This fork is being actively maintained — Insomnium is a useful tool worth keeping in working order. Recent work includes a full dependency security pass (Electron upgraded, native modules refreshed, application-layer security fixes), CI hardening, and packaged builds for macOS / Windows / Linux on every release. Issues and pull requests are welcome.

## General

I have removed user login, tracking, analytics, etc, from Insomnia so it is now a 100% local app. (And runs faster!)


## Download

Insomnium is available for Mac, Windows, Ubuntu, Debian, CentOS, Fedora and [can be downloaded here](https://github.com/yokomohoyo/insomnium/releases). Insomnium is also [available on AUR for ArchLinux](https://aur.archlinux.org/packages/insomnium-bin).

### macOS (Homebrew)

```sh
brew install --cask yokomohoyo/tap/insomnium
```

Alternatively, you can build Insomnium from source on your local machine using `npm run app-package`.


## gRPC

Insomnium is a full gRPC client. Create a new request and pick the **gRPC** type to get started.

- **All four method types** — unary, server-streaming, client-streaming, and bidirectional streaming. Responses stream into the response pane in real time.
- **Two ways to load your API surface:**
  - **Import `.proto` files** — add a single file or import a whole directory tree (includes are resolved automatically, and the bundled `google/protobuf/*` well-known types are available).
  - **Server reflection** — point Insomnium at a server with reflection enabled and it discovers the available services and methods for you.
- **URL schemes** — use `grpc://host:port` for plaintext or `grpcs://host:port` for TLS. If you omit the scheme, TLS is inferred for common conventions (port `:443`, `*.run.app` Cloud Run, and `*.googleapis.com`) so you don't silently send plaintext to a host that requires TLS.
- **Metadata & auth** — attach per-request metadata (headers), chain authentication strategies (Bearer, Basic, GCP ID Token, and more), and use client certificates inherited from the workspace.
- **Request templates** — selecting a method auto-generates a skeleton JSON message from the request type, so you have a starting point to edit.
- **Safety knobs** — configurable per-request timeout, plus a cap on the number of streamed messages to avoid runaway memory use.

> Fetching protos from a reflection server that sits behind auth? Add the bearer/token under **Settings → Proto Tokens**.


## MCP automation server

Insomnium can expose **itself** as a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server, so MCP-aware tools — like Claude Code — can list, inspect, create, and run your saved requests programmatically. This lets an AI assistant understand and drive your API collections directly.

**Enable it:** open **Settings → Automation (MCP)** and toggle on *Enable MCP automation server*. The server is **disabled by default**.

- Optionally set a fixed **port** (`0` lets the OS pick a free one; a fixed port keeps the connection URL stable across restarts).
- Copy the auto-generated **Bearer token**, the **connection URL**, or the ready-to-paste one-line install command, e.g.:

  ```sh
  claude mcp add --transport sse insomnium http://127.0.0.1:<port>/sse --header "Authorization: Bearer <token>"
  ```

**Security:** the server binds to loopback only (`127.0.0.1`), is gated by a Bearer token (regenerable from the same screen), and uses Server-Sent Events (SSE) over HTTP. It is never exposed to your network.

**What connected tools can do** — the exposed tool surface covers:

- **Projects & workspaces** — list/create projects, workspaces (collections or design docs), and folders.
- **Request introspection** — list HTTP/gRPC/WebSocket requests, read full request details, and read recent responses (including the last response body).
- **Execution** — `send_http_request` and `send_grpc_request` (all four gRPC method types), with optional environment and timeout overrides.
- **Mutation** — create, update, and delete requests.
- **Auth strategies** — list, add, update, and remove authentication on a request.
- **Environments** — list environments, read the active one, and switch it.
- **Proto/gRPC** — list and import `.proto` files (single file or directory), inspect services/methods, and update gRPC metadata.


## Backstory

Insomnium is a fork of [Kong/insomnia at 2023.5.8](https://github.com/ArchGPT/insomnia), the last commit before compulsory account login was introduced. In a sense, Insomnium is a community response to [the latest product update that forces account creation w/o warning](https://news.ycombinator.com/item?id=37680522).

![HN](https://github.com/yokomohoyo/insomnium/blob/main/hn.png?raw=true)

I was among the users who were deeply affected by the recent change. I still think Insomnia is a nice product in general, but I have to disagree with the direction it is going. So I have decided to fork it and make it 100% local and privacy-focused.

> *I choose to walk in shades.* <br>
> *Hearken now, to the song of dusk* <br>
> *The forest venerates your name* <br> 
>--- [Insomnium, song of the dusk](https://youtu.be/nTIDh1miBSc)


## Migration from Insomnia

You can use the GUI (under `Preferences/Data`) or directly e.g. for linux `cp -r ~/.config/Insomnia ~/.config/Insomnium`. [For MacOS and Windows, you can read more here](https://archgpt.dev/insomnium/migration-guide). Feel free to open an issue/discussion if anything weird happens.

## Develop Insomnium

Development on Insomnium can be done on Mac, Windows, or Linux as long as you have [Node.js](https://nodejs.org) and [Git](https://git-scm.com/). See the `.nvmrc` file located in the project for the correct Node version.

<details>
<summary>Initial Dev Setup</summary>

This repository is structured as a monorepo and contains many Node.JS packages. Each package has its own set of commands, but the most common commands are available from the root [`package.json`](package.json) and can be accessed using the `npm run …` command. Here are the only three commands you should need to start developing on the app.

```shell
# Install and Link Dependencies
npm i

# Run Lint
npm run lint

# Run type checking
npm run type-check

# Run Tests
npm test

# Start App with Live Reload
npm run dev
```

### Linux

If you are on Linux, you may need to install the following supporting packages:

<details>
<summary>Ubuntu/Debian</summary>

```shell
# Update library
sudo apt-get update

# Install font configuration library & support
sudo apt-get install libfontconfig-dev
```

</details>

<details>
<summary>Fedora</summary>

```shell
# Install libcurl for node-libcurl
sudo dnf install libcurl-devel
```

</details>

Also on Linux, if Electron is failing during the install process, run the following

```shell
# Clear Electron install conflicts
rm -rf ~/.cache/electron
```

### Windows

If you are on Windows and have problems, you may need to install [Windows Build Tools](https://github.com/felixrieseberg/windows-build-tools)

</details>

<details>
<summary>Editor Requirements</summary>

You can use any editor you'd like, but make sure to have support/plugins for the following tools:

- [ESLint](http://eslint.org/) - For catching syntax problems and common errors
- [JSX Syntax](https://facebook.github.io/react/docs/jsx-in-depth.html) - For React components

</details>

## Bugs and Feature Requests

Before submitting a bug or a feature request, you can read the
[issue guidelines](CONTRIBUTING.md#using-the-issue-tracker).

<!-- For more generic product questions and feedback, join the [Slack Team](https://chat.insomnia.rest). -->

## Contributing

Please read through our [contributing guidelines](CONTRIBUTING.md) and [code of conduct](CODE_OF_CONDUCT.md). Included are directions for opening issues, coding standards, and notes on development.

<!-- ## Documentation

Check out our open-source [Insomnium Documentation](https://archgpt.dev/insomnium-doc). -->


## License

[MIT](LICENSE)
