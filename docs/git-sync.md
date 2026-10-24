# Git Sync

Git Sync keeps a collection or design document in a Git repository you host anywhere: GitHub, GitLab, Bitbucket, Gitea, or your own server. There's no account, no Insomnium server in between, and no limit on users. Everyone who can reach the repository can work on the collection, with branches, commits, pulls and pushes.

## Connect a collection

1. Open the collection, and click **Git Sync** at the bottom of the sidebar, then **Setup Git Sync**.
2. Enter the repository's URL, the name and email for your commits, your username, and an **authentication token**: a personal access token from your Git host, with read and write access to the repository. The dialog links to the instructions for GitHub, GitLab, Bitbucket and Azure DevOps. If another repository on the same host is already set up, pick its saved sign-in instead of entering it again.
3. **Sync**. Insomnium fetches the repository. An empty one is ready for your first commit.

A repository holds one collection. Linking a collection to a repository that already holds a different one is refused: clone that one instead.

### Over SSH

An SSH address, such as `git@github.com:org/repo.git` or `ssh://git@git.example.com:2222/org/repo.git`, connects over SSH with your SSH keys, as `git` does: no token needed.

- **Keys**: offered in the order `ssh` offers them. First a **SSH Key File** you name in the repository's settings, with its passphrase if it has one, and the `IdentityFile` your `~/.ssh/config` names for the host. Then your SSH agent's keys (`SSH_AUTH_SOCK` on macOS and Linux; on Windows the OpenSSH agent service, then Pageant), then `~/.ssh/id_ed25519`, `id_ecdsa` and `id_rsa`. With a key file named in the repository's settings, or `IdentitiesOnly yes` for the host, only those keys are offered (or, with none named, `~/.ssh/id_*`), the agent's copies of them included, and none of the agent's others, which could sign in as another account. A key with a passphrase works through the agent (the `.pub` file beside it tells which of the agent's keys it is), or as the repository's key file with its passphrase.
- **`~/.ssh/config`**: a `Host` alias works as the address's host, with its `HostName`, `User`, `Port`, `IdentityFile` and `IdentitiesOnly`. So `work:org/repo.git`, with a `Host work` block, connects the way `git` would.
- **Host keys**: the host's key is checked against `~/.ssh/known_hosts`. A host not in it is shown with its key's fingerprint, and Insomnium asks before trusting it. Compare the fingerprint with the ones your host publishes ([GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints), [GitLab](https://docs.gitlab.com/user/gitlab_com/#ssh-host-keys-fingerprints), [Bitbucket](https://support.atlassian.com/bitbucket-cloud/docs/configure-ssh-and-two-step-verification/)). Insomnium keeps the hosts you trust in its own list and leaves your `known_hosts` as it is. A host whose key isn't the one trusted for it is refused, as `ssh` refuses it: someone may be in between.

To use the address's `https://` form and a token instead, choose **HTTPS** under **Connect With**.

A public repository can be cloned and pulled without signing in: leave the username and token empty. Pushing to it needs them.

### Only on this computer

Leave the URL empty, and enter only the name and email for your commits, for a repository kept on this computer. It has commits, branches, history and the commit dialog's list of changes, but no push, pull or fetch. To share it later, enter a URL in **Repository Settings**, then push.

The token is saved encrypted with your operating system's keychain: see [Saved credentials](../README.md#saved-credentials).

## Clone a repository

**Git Clone**, on the dashboard, adds a repository's collection to the project, with the same details as above. If the repository is empty, it gets a new collection.

## Work with it

The **Git Sync** menu, at the bottom of the sidebar, shows the branch and has:

- **Commit**: lists what changed since the last commit. Under each change, **Changed** lists its fields, from what to what. For headers, parameters and form fields, it says which were added, removed or changed. A change to only the order or timestamps says so. Choose what to stage, write a message, and commit. Changes can also be rolled back from there.
- **Push** and **Pull**. A pull applies changes made upstream, including requests that were deleted there. It never writes over changes you haven't committed. If upstream changed a request you've changed and not committed, the pull stops before changing anything and names the request: commit your change (the pull then merges the two) or undo it, and pull again. A request deleted upstream that you've changed is kept. Switching branches and merging work the same way. When the remote has commits your branch doesn't, a push is turned down: pull them in first, or **Force Push** to replace the remote's branch with yours, which drops the commits you don't have.
- **Pull with Rebase**: your branch's own commits go on top of what came, one at a time, so the history stays a line, with no merge commit. A request both sides changed merges field by field, as a pull does. If a field clashes, nothing changes until you choose (see below). A branch with a merge commit of its own can't be rebased: pull instead.
- **Fetch**, to see whether the remote has new commits, and its tags.
- **History**: the commits on this branch.
- **Branches**: create, switch to, merge, rebase and delete branches, local and remote. **Rebase onto** puts the current branch's commits on top of the other branch.
- **Tags**: tag the current commit, with a message (an annotated tag) or without, push a tag, and delete one here or on the remote too. A fetch or pull brings the remote's tags on the commits it brings, and keeps the ones you made.
- **Stashes**: **Stash** keeps your uncommitted changes aside and undoes them, so you can pull, switch branches or try something else. **Pop** brings a stash back and drops it; **Apply** brings it back and keeps it. A stash applies onto whatever is there now, field by field, so a request changed since keeps those changes too.
- **Create Pull Request**, for a repository on GitHub, GitLab or Bitbucket: opens the host's page to propose the branch's changes.

### When both sides changed something

A pull or merge combines the two sides a request (or folder, or environment) at a time, field by field. If you changed a request's method and someone else changed its URL, both changes are kept.

When both sides changed the same field differently, **Changed on Both Sides** lists each request with those fields, yours and theirs. Choose **Keep yours** or **Take theirs** for each, then **Merge**. Your other changes, and theirs, are merged either way. A merge stays on your branch. A rebase, and applying a stash, ask the same way (yours being your commit, or what's here now, against the stash).

## What's in the repository

The collection is stored as YAML, one file per item, in a `.insomnium/` folder at the repository's root:

```
.insomnium/
  Workspace/wrk_….yml
  Environment/env_….yml
  RequestGroup/fld_….yml
  Request/req_….yml
  ApiSpec/spc_….yml
  …
```

Only the collection's own items are synced: its requests, folders, environments, specs, unit tests, gRPC proto files and WebSocket payloads. Private environments, responses, cookies, certificates, OAuth tokens and your settings stay on your computer. Other files in the repository are left as they are, so the collection can live next to the code of the API it tests.

When a pull brings in a file, Insomnium checks that it's one of those kinds of items, in its own folder, and belongs to this collection, before it changes anything.

## Repositories from Insomnia

Insomnia, and Insomnium before version 0.3, kept the collection in `.insomnia/` instead. A repository like that clones as usual, and its collection stays in `.insomnia/`, so people using Insomnia can keep sharing it.

Insomnia 12.6 and later can also keep a project in a repository as Insomnia v5 YAML files, one for each collection or document ("Git projects"). Cloning one of those imports each file as a collection or document of its own: files anywhere in the repository, except in dot folders and `node_modules`, up to 100 of them. They aren't linked to the repository, because Git Sync keeps one collection to a repository, in its own folder, and would add that folder to a repository laid out for Insomnia. To share one with Git Sync, link it to a repository of its own. A file can also be brought in with [Import](import-export.md).

## Not yet

- Signing in through GitHub or GitLab in the browser.
- SSH host certificates (`@cert-authority` in known_hosts), and `~/.ssh/config`'s `Match` blocks and `Include`.
- Merging a request deleted on one side and changed on the other. Undo one of the two, commit, and merge again.
- Opening a folder that's already checked out on your computer. [Folder Sync](folder-sync.md) can keep a collection in one, as readable files.
