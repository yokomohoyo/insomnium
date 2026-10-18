# Git Sync

Git Sync keeps a collection or design document in a Git repository you host anywhere: GitHub, GitLab, Bitbucket, Gitea, or your own server. There's no account, no Insomnium server in between, and no limit on users. Everyone who can reach the repository can work on the collection, with branches, commits, pulls and pushes.

## Connect a collection

1. Open the collection, and click **Git Sync** at the bottom of the sidebar, then **Setup Git Sync**.
2. Enter the repository's URL, the name and email for your commits, your username, and an **authentication token**: a personal access token from your Git host, with read and write access to the repository. The dialog links to the instructions for GitHub, GitLab, Bitbucket and Azure DevOps. If another repository on the same host is already set up, pick its saved sign-in instead of entering it again.
3. **Sync**. Insomnium fetches the repository. An empty one is ready for your first commit.

A repository holds one collection. Linking a collection to a repository that already holds a different one is refused: clone that one instead.

Git Sync talks HTTPS. An SSH address (`git@github.com:org/repo.git` or `ssh://…`) is changed to its `https://` form, and the token is used to sign in.

A public repository can be cloned and pulled without signing in: leave the username and token empty. Pushing to it needs them.

The token is saved encrypted with your operating system's keychain: see [Saved credentials](../README.md#saved-credentials).

## Clone a repository

**Git Clone**, on the dashboard, adds a repository's collection to the project, with the same details as above. If the repository is empty, it gets a new collection.

## Work with it

The **Git Sync** menu, at the bottom of the sidebar, shows the branch and has:

- **Commit**: lists what changed since the last commit. Choose what to stage, write a message, and commit. Changes can also be rolled back from there.
- **Push** and **Pull**. A pull applies changes made upstream, including requests that were deleted there. A request you changed and haven't committed is kept.
- **Fetch**, to see whether the remote has new commits.
- **History**: the commits on this branch.
- **Branches**: create, switch to, merge and delete branches, local and remote.

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

Insomnia 12.6 and later can also keep a collection in a repository as Insomnia v5 YAML files ("Git projects"). Git Sync doesn't read those, but you can bring one in with [Import](import-export.md).

## Not yet

- SSH keys, and signing in through GitHub or GitLab in the browser.
- Opening a folder that's already checked out on your computer.
