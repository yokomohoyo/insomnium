# Folder Sync

Folder Sync keeps a collection in a folder of your own as readable YAML files, a file per request, and keeps the two in step. Edit a request in the app and its file changes. Edit the file in an editor, add one, delete one, or check out another branch, and the collection changes. Use it to review a collection in pull requests, change it with the tools you use for code, or keep it next to the code of the API it tests, with whatever version control you like.

## Sync a collection

In the collection's menu, choose **Sync to a Folder…** and pick a folder. An empty folder gets the collection's files. A folder that already has this collection's files (from a clone, or from before) brings in what changed there. A folder with another collection's files is refused.

While a collection is synced, the menu has **Show the Synced Folder** and **Stop Syncing to the Folder**. Stopping leaves the files where they are. The sync carries on when the app opens again, and takes in what changed in the folder while it was closed.

Keep the collection in a folder of its own, such as `api/` in a repository: Insomnium reads every `.yaml` file under the folder you pick.

Its files' JSON Schema goes in the folder too, as `.insomnium/folder.schema.json`, and each file names it on its first line, so an editor completes and checks them as you write: see [Your editor](editors.md).

## The files

```
insomnium.yaml              the collection
environments/_base.yaml     its base environment
environments/Staging.yaml   a sub environment
Orders/_folder.yaml         a folder
Orders/Create order.yaml    a request, with its examples
```

A directory is a folder and a file is a request, both named after them, so moving a file to another directory moves the request. `order` says where an item sits among the others in its folder. Timestamps are left out, so a diff shows only what changed.

```yaml
_id: req_9f3c…
type: Request
name: Create order
method: POST
url: "{{ base_url }}/orders"
body:
  mimeType: application/json
  text: '{ "sku": "A-1" }'
order: 2
```

A new file needs a `type` (`Request`, `GrpcRequest`, `WebSocketRequest` or `McpRequest`, or `RequestGroup` in `_folder.yaml`, or `Environment` in `environments/`), and gets its `_id` when Insomnium takes it in. A file without a `type` is left alone, so other YAML in the folder, such as a CI workflow, isn't mistaken for a request. Dot folders such as `.git` are skipped.

Requests, folders, environments and response examples are synced. Private environments, responses, cookies, certificates and OAuth tokens stay in the app, as with [Git Sync](git-sync.md). A design document's spec isn't written to the folder; use Git Sync for that.

## When both sides change

The latest change wins. If a file and its request are both changed before Insomnium sees either, the file's version is kept. To combine changes from other people, use your version control's merge on the files, and the collection takes in the result.

Only a file that changed is taken in, so the rest of the folder can't undo what you change in the app. A file that doesn't read (half saved, or with merge conflict markers) is left as it is, and so is what it holds in the collection, until it reads again. A request goes from the collection only when its file is deleted.

A file copied from another (with the same `_id`), or holding another collection's `_id`, becomes a new request, and the original is left as it was. Insomnium never writes over a file that isn't the collection's: a request named like one gets a name of its own, such as `Status (2).yaml`.
