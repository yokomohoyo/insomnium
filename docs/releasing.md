# Releasing

Releases are immutable once published: their assets can't be added, replaced or
deleted, and their tag can't move. So every asset goes on a draft first, and
publishing is the last step.

1. Merge the version bump, and wait for main's checks on that commit.
2. Create a draft release for that commit, by its full SHA:

   ```bash
   gh release create X.Y.Z --draft --target <full SHA> --title X.Y.Z --notes-file notes.md --generate-notes
   ```

3. Build it. **Release Build** checks that the draft's commit is on main,
   builds and signs the installers on macOS, Windows and Ubuntu, and attaches
   them to the draft with a `SHA256SUMS-<os>.txt` for each OS and a build
   provenance attestation for each file:

   ```bash
   gh workflow run release-build.yml --ref main -f tag=X.Y.Z
   ```

   If it fails, fix it and run it again: the draft can still change.
4. Once it has passed, look over the draft and publish it. Publishing creates
   the tag:

   ```bash
   gh release edit X.Y.Z --draft=false
   ```

Publishing starts **Release On Publish**, which checks the assets again, and the
**Server Image** workflow. The **APT Repository**, **Bump Homebrew Cask**, **AUR
Package** and **npm Packages** workflows run after Release On Publish passes.

A release has 12 assets: nine builds (`.dmg` and `.zip` for macOS; the
installer `Insomnium.Core-X.Y.Z.exe` and the portable `.exe` for Windows;
`.AppImage`, `.deb`, `.rpm`, `.snap` and `.tar.gz` for Linux) and a
`SHA256SUMS-<os>.txt` for each OS.

**winget.** The **winget Manifest** workflow writes the manifest files for a
published release from the Windows installer's URL and SHA-256, and uploads
them as an artifact; it submits nothing:

```bash
gh workflow run winget-manifest.yml --ref main -f tag=X.Y.Z
```

They go to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs)
in a pull request made by hand, under the path the artifact has them in.

The **Windows Installer** workflow runs on pull requests that change the
installer, and by hand: on a Windows runner it installs the installer silently,
runs the installed app, uninstalls it, and upgrades an install made by the
Squirrel installer of 0.8.13.

A dry run builds any commit on every OS, unsigned, and uploads nothing:

```bash
gh workflow run release-build.yml --ref main -f tag=<full SHA> -f dry_run=true
```

Tags can only be created by an admin (the "tag creation" ruleset), and release
tags can't be moved or deleted (the "release tags" ruleset).
