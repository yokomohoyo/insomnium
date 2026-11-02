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

A dry run builds any commit on every OS, unsigned, and uploads nothing:

```bash
gh workflow run release-build.yml --ref main -f tag=<full SHA> -f dry_run=true
```

Tags can only be created by an admin (the "tag creation" ruleset), and release
tags can't be moved or deleted (the "release tags" ruleset).
