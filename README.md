# Insomnium API Client

Insomnium is a 100% local and privacy-focused open-source API client for testing GraphQL, REST, WebSockets, Server-sent events and gRPC in development/production.

- ✅ works 100% offline, the way a local testing tool should behave <br>
- ✅ no cloud services, no tracking/communication to external servers behind the scene <br>
- ✅ share collections with your team from a [server on your own network](#team-server) <br>
- ✅ an optional new-release check (Preferences → General → Updates) is off unless you turn it on <br>

[![license](https://img.shields.io/github/license/yokomohoyo/insomnium.svg)](LICENSE)
[![GitHub Discussions](https://img.shields.io/github/discussions/yokomohoyo/insomnium)](https://github.com/yokomohoyo/insomnium/discussions)

![Insomnium API Client](https://raw.githubusercontent.com/yokomohoyo/insomnium/main/screenshots/v0.1.png)

## Current Status

This fork is being actively maintained — Insomnium is a useful tool worth keeping in working order. Recent work includes a full dependency security pass (Electron upgraded, native modules refreshed, application-layer security fixes), CI hardening, and packaged builds for macOS / Windows / Linux on every release. Issues and pull requests are welcome.

## General

I have removed user login, tracking, analytics, etc, from Insomnia so it is now a 100% local app. (And runs faster!)

**[Documentation](docs/README.md)**: getting started, template tags, scripts, tests and the runner, Git Sync, import and export, and plugins.


## Download

Insomnium is available for Mac, Windows, Ubuntu, Debian, CentOS, Fedora and [can be downloaded here](https://github.com/yokomohoyo/insomnium/releases). macOS builds are signed and notarized with the maintainer's Apple Developer ID; Windows builds aren't signed yet. On Arch Linux, use the AppImage or `.tar.gz` from the releases page for now: the `insomnium-bin` AUR package is not maintained by this project and is still on 0.2.3 ([#121](https://github.com/yokomohoyo/insomnium/issues/121)).

### macOS (Homebrew)

```sh
brew install --cask yokomohoyo/tap/insomnium
```

### Debian / Ubuntu (APT)

```sh
curl -fsSL https://yokomohoyo.github.io/insomnium/apt/insomnium-archive-keyring.gpg \
  | sudo tee /usr/share/keyrings/insomnium-archive-keyring.gpg > /dev/null

echo "deb [arch=amd64 signed-by=/usr/share/keyrings/insomnium-archive-keyring.gpg] https://yokomohoyo.github.io/insomnium/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/insomnium.list

sudo apt update && sudo apt install insomnium
```

Updates then arrive through `apt upgrade` like any other package. Installing the
`.deb` directly also registers this repository, so a downloaded `.deb` stays up
to date too — see [docs/apt-repository.md](docs/apt-repository.md) for details
and how to opt out.

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
- **Mutation** — create, update, and delete requests; create folders.
- **Collections** — run a workspace's or folder's requests with their assertions (`run_requests`), import any format the app imports (`import_collection`), export as Insomnium, Postman or OpenAPI (`export_workspace`), and list cookies (values only on request).
- **Auth strategies** — list, add, update, and remove authentication on a request.
- **Environments** — list environments, read the active one, and switch it.
- **Proto/gRPC** — list and import `.proto` files (single file or directory), inspect services/methods, and update gRPC metadata.

**For coding agents:** `npx insomnium-cli agent install` installs a skill for Claude Code that tells it how to use your collections: find a request, check the environment, send it, read the response and its assertions, and run a folder. See [insomnium-cli](packages/insomnium-cli/README.md).


## Team server

A team can share its collections from a server of its own: a NAS (a Synology, say), a home server, or any machine with Docker. Nothing goes through a cloud service. `insomnium-server team` keeps each collection as a Git repository and serves it for Git Sync. It adds accounts, a role for each person on each collection (viewer, editor or owner), and a log of who pushed what.

Start it with a folder for its data:

```sh
docker run -d --name insomnium-team --restart unless-stopped   -p 8080:8080   -v /volume1/docker/insomnium-team:/data   -e INSOMNIUM_TEAM_ADMIN=kim   ghcr.io/yokomohoyo/insomnium-server team
docker logs insomnium-team   # the admin's password, shown once on the first start
```

Put it behind HTTPS (a NAS's reverse proxy does), as every call carries a password or token. Then, in Insomnium:

1. Open **Git Clone** in a project, or **Git Settings** in a collection, and choose the **Team Server** tab.
2. Sign in with the server's address, your user name and your password. Insomnium makes an access token for this computer and keeps only that, encrypted (see [Saved credentials](#saved-credentials)).
3. Pick a collection to clone, or one to sync the open collection to. In Git Settings you can also start a new one.
4. Commit, push and pull as with any Git Sync repository.

**Sign Out** in the same tab forgets the sign-in and revokes its token. Git on the command line works too, with your user name and a token.

Setting it up, managing accounts and roles, the API and every option: [Share collections with a team](packages/insomnium-server/README.md#share-collections-with-a-team). Git Sync itself: [docs/git-sync.md](docs/git-sync.md).


## Saved credentials

Insomnium encrypts the credentials it keeps for you before writing them to its database: OAuth 2 access, refresh and ID tokens, Git Sync credentials, client certificate passphrases, and the proto and MCP tokens in Settings, and team server sign-ins. Each value is encrypted with AES-256-GCM under a key that your operating system's keychain protects (macOS Keychain, Windows DPAPI, or GNOME Keyring / KWallet on Linux). The key is created the first time it's needed: when you first save one of these, or at the first launch of this version if you already have some. That is when a keychain prompt may appear.

What this does not cover:

- values you type into requests, auth tabs and environments;
- response history and timelines (the `responses` folder), which keep what was sent and received, each request's `Authorization` header included. The exception is OAuth 2 token requests: their responses and timelines are kept with the tokens, the client secret, the code and any password replaced by `••••••`;
- `~/.insomnium/mcp.json`, which holds the MCP token while the MCP server runs, so tools can find it.

How it behaves:

- **Another computer or account.** Copying the data folder copies the encrypted values but not the key, which stays with your OS account. Saved credentials read as empty there and Insomnium tells you so. Enter them again and they're saved under a new key.
- **Linux without a keyring.** When no keyring is reachable, Electron falls back to a built-in key, which only obfuscates. Insomnium still saves your credentials and tells you once. Run and unlock GNOME Keyring or KWallet for real protection; the next launch that finds it moves your credentials to a new key. The snap reaches the keyring only after `sudo snap connect insomnium:password-manager-service`.
- **Locked or unavailable keychain.** If the keychain can't unlock the key, or keeps not answering for 30 seconds, credentials you enter still work for that session but are not written to disk, not even in plain text. Encrypted ones saved earlier read as empty until it can; ones an earlier version saved in plain text stay readable, and in plain text, until a launch with a working keychain. You'll see a notice when this happens.
- **Copies from earlier versions.** Earlier versions stored these in plain text. On the first launch with a working keychain Insomnium encrypts them in `insomnia.sqlite` and compacts the file, but it leaves other copies alone: the copy of your data it takes in the `backups` folder on each upgrade (the newest three are kept), the `insomnia.*.db` files from versions that predate the SQLite store, any copies of the data folder you made, and the original Insomnia folder if you migrated from it. Delete those if that matters to you.
- **Downgrading.** Older versions can't read the encrypted values, so re-enter saved credentials there.


## Backstory

Insomnium is a fork of [Kong/insomnia at 2023.5.8](https://github.com/Kong/insomnia/tree/core@2023.5.8), the last commit before compulsory account login was introduced. In a sense, Insomnium is a community response to [the latest product update that forces account creation w/o warning](https://news.ycombinator.com/item?id=37680522).

![HN](https://github.com/yokomohoyo/insomnium/blob/main/hn.png?raw=true)

I was among the users who were deeply affected by the recent change. I still think Insomnia is a nice product in general, but I have to disagree with the direction it is going. So I have decided to fork it and make it 100% local and privacy-focused.

> *I choose to walk in shades.* <br>
> *Hearken now, to the song of dusk* <br>
> *The forest venerates your name* <br> 
>--- [Insomnium, song of the dusk](https://youtu.be/nTIDh1miBSc)


## Migration from Insomnia

You can use the GUI (under `Preferences/Data`) or copy the data folder directly, before starting Insomnium for the first time:

- Linux: `cp -r ~/.config/Insomnia ~/.config/Insomnium`
- macOS: `cp -R ~/Library/Application\ Support/Insomnia ~/Library/Application\ Support/Insomnium`
- Windows (Command Prompt): `xcopy /E /I "%APPDATA%\Insomnia" "%APPDATA%\Insomnium"`

Feel free to open an issue/discussion if anything weird happens.

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

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. Insomnium has no account, telemetry or analytics. It contacts only what you point it at: the requests you send, your Git remotes, a team server you sign in to, the plugin registry when you install a plugin, an AI model's endpoint if you set one up, and, only if you turn on "Check for new releases" (off by default), api.github.com once a day for the latest release.

## License

[MIT](LICENSE)
