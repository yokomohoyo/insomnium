# APT repository

Insomnium's `.deb` has always been a well-formed package — it declares its
dependencies, registers `update-alternatives`, and installs an AppArmor profile.
What it lacked was a *repository*: apt had no upstream to check, so `apt upgrade`
never offered a new version and every update meant manually downloading the next
`.deb` from GitHub Releases.

This directory documents the repository that fixes that. Two pieces work together:

1. **[`.github/workflows/apt-repo.yml`](../.github/workflows/apt-repo.yml)** builds a
   signed APT index from recent GitHub Release assets and publishes it to GitHub
   Pages under `/apt`.
2. **The `.deb` postinst** ([`packaging/linux/after-install.tpl`](../packages/insomnia/packaging/linux/after-install.tpl))
   drops a `sources.list` entry and the signing key on install, so a user who
   installs the `.deb` once is thereafter tracked by apt — the same approach
   Chrome and VS Code take.

---

## One-time setup

None of this is automated, because it involves a private key and repository
settings that only the account owner should touch.

### 1. Generate a signing key

Do this on a trusted machine. The key signs the repository index; it is not a
code-signing key.

```bash
gpg --full-generate-key --expert
```

Choose RSA 4096, no expiry (or a long one — an expired key breaks `apt update`
for every existing install), and a real passphrase. Use an identity you control,
e.g. `Insomnium APT <you@example.com>`.

Find the key id:

```bash
gpg --list-secret-keys --keyid-format=long
```

### 2. Add the repository secrets

Under **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
| --- | --- |
| `APT_GPG_PRIVATE_KEY` | output of `gpg --armor --export-secret-keys <KEYID>` |
| `APT_GPG_PASSPHRASE` | the passphrase from step 1 (create it empty if the key has none) |

Keep an offline backup of the private key. Losing it means every existing
install must be re-pointed at a new key by hand.

### 3. Commit the public key into the package

The postinst installs this to `/usr/share/keyrings` so apt can verify the repo,
so the *public* half has to ship inside the `.deb`:

```bash
gpg --export <KEYID> > packages/insomnia/packaging/linux/insomnium-archive-keyring.gpg
```

Commit that file. It is public key material — safe to have in the repository.

> If this file is missing the build still succeeds, but the postinst skips
> registering the repository (it is guarded by a `-f` check) and you get the old
> non-apt-integrated behaviour with no error. If apt integration ever silently
> stops working, check this file first.

### 4. Enable GitHub Pages

**Settings → Pages → Source: GitHub Actions.**

Not "Deploy from a branch". The `.deb` files are ~120 MB each and GitHub rejects
any pushed file over 100 MB, so a `gh-pages` branch cannot physically hold this
repository — the first attempt at that failed with `GH001: Large files detected`.
The workflow uploads the site as an artifact instead, which has no per-file
limit. There is no `gh-pages` branch and there should not be one.

The workflow builds into `_site/apt/`, so the repo lands at
`https://yokomohoyo.github.io/insomnium/apt`.

That URL is hardcoded in the postinst template. If Pages is served from a custom
domain, update `APT_SOURCE_URL` there to match.

---

## How it runs

The workflow triggers on `release: published`, after release assets exist. It:

1. Downloads `.deb` assets from the most recent releases (default 5 — see below)
2. Builds `dists/stable/main/binary-amd64/Packages` with `apt-ftparchive`
3. Generates and GPG-signs `Release`, producing `InRelease` and `Release.gpg`
4. Verifies its own signature and that the index actually lists `insomnium`
5. Checks the payload against the published-site limit
6. Uploads `_site` as a Pages artifact and deploys it

It can also be run manually via **workflow_dispatch**, which takes a `keep`
input if you need a different number of retained releases.

### Two size limits, and why the deployment method matters

Each `.deb` is ~120 MB, which runs into two separate GitHub limits:

| Limit | Value | Applies to |
| --- | --- | --- |
| Per-file push limit | 100 MB, hard | Any file committed to a git branch |
| Published-site limit | ~1 GB, soft | The deployed Pages site |

The per-file limit is why this uses **artifact-based** Pages deployment. A
branch-based deploy (`gh-pages`) has to push each `.deb` through git, and every
one of them is over 100 MB — unfixable by pruning, since a single package
already exceeds it.

The site limit still applies to the artifact, so the workflow keeps the **5 most
recent** releases with a `.deb` (≈600 MB) and rebuilds the whole tree each run.
A guard step fails the build above 900 MB and warns above 700 MB, so raising
`keep` surfaces the problem before deploy time rather than after. If you need
deeper history, a hosted apt service (Cloudsmith, packagecloud) is the better
answer; both have OSS tiers.

Because the tree is rebuilt wholesale each run, dropping out of the pool is how
old versions are pruned — there is no separate cleanup step.

---

## Installing from the repository

Users who already have a `.deb` installed from `0.3.0-rc.8` onward get this
automatically. For a fresh install without downloading a `.deb` first:

```bash
curl -fsSL https://yokomohoyo.github.io/insomnium/apt/insomnium-archive-keyring.gpg \
  | sudo tee /usr/share/keyrings/insomnium-archive-keyring.gpg > /dev/null

echo "deb [arch=amd64 signed-by=/usr/share/keyrings/insomnium-archive-keyring.gpg] https://yokomohoyo.github.io/insomnium/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/insomnium.list

sudo apt update && sudo apt install insomnium
```

Thereafter `apt upgrade` picks up new releases like any other package.

### Opting out

To install the `.deb` without registering the repository — useful for
unattended images:

```bash
sudo INSOMNIUM_SKIP_APT_SOURCE=1 apt install ./Insomnium.Core-<version>.deb
```

`apt remove` leaves the source list in place so a later reinstall still sees the
repo; `apt purge` removes both it and the keyring.

---

## Verifying a published repository

```bash
curl -fsSL https://yokomohoyo.github.io/insomnium/apt/dists/stable/InRelease | gpg --verify
apt-cache policy insomnium   # after adding the source
```

`apt-cache policy` should report a `Candidate:` matching the newest published
release. If it reports `(none)` the index is present but empty — the most likely
cause is the `apt-ftparchive` invocation being changed to include an `--arch`
filter, which silently matches nothing for these files.
