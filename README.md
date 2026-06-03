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


## gRPC tooling

A few quality-of-life additions to make gRPC requests faster to author:

- **Auto-generated request body.** Picking a method fills the body editor with a JSON skeleton derived from the request Message — every field listed with a type-appropriate empty value (`""`, `0`, `false`, `[]`, `{}`, first enum / first oneof option). Works with both uploaded `.proto` files and server reflection. Your edits are preserved on method switch; templates only refill when the body is empty.

- **Import protos from a URL.** In the proto-files modal there's an "Import from URL" field that accepts:
  - `github.com/<owner>/<repo>/blob/<ref>/<path>.proto` — single file
  - `github.com/<owner>/<repo>/tree/<ref>[/<path>]` — recursive directory walk (only `.proto` files kept)
  - `raw.githubusercontent.com/...` and any `https://….proto` — direct
  - `buf.build/<owner>/<repo>[:<ref>]` — fetches the module + transitive deps from BSR (public modules)

  Unauthenticated GitHub is rate-limited to 60 requests/hour, which is fine for single-file imports and small trees. Private BSR modules and a `GITHUB_TOKEN` setting are not yet wired.


## Download

Insomnium is available for Mac, Windows, Ubuntu, Debian, CentOS, Fedora and [can be downloaded here](https://github.com/yokomohoyo/insomnium/releases). Insomnium is also [available on AUR for ArchLinux](https://aur.archlinux.org/packages/insomnium-bin). 

Alternatively, you can build Insomnium from source on your local machine using `npm run app-package`.


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
