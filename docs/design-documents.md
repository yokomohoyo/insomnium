# Design documents

A design document is a collection with an OpenAPI spec at its heart. Create one from the dashboard, or import an OpenAPI 3.0 or Swagger 2.0 file into one.

It has three tabs, at the top:

- **Design**: the spec, in YAML or JSON.
- **Debug**: the document's requests, as in any collection.
- **Test**: [unit tests](testing.md#unit-tests-in-design-documents) for its requests.

## Design

The editor checks the spec as you type, with [Spectral](https://github.com/stoplightio/spectral)'s OpenAPI rules. Problems are listed under the editor; click one to go to its line. The sidebar outlines the spec's paths, schemas and other parts, and **Toggle Preview** shows it as API documentation.

### Your own lint rules

When the document is synced with [Git Sync](git-sync.md), a `.spectral.yaml` at the root of the repository replaces the built-in rules. It can extend the built-in rulesets (`spectral:oas`, `spectral:asyncapi`, `spectral:arazzo`) and add, change or turn off rules:

```yaml
extends: spectral:oas
rules:
  operation-tags: off
  info-contact: error
```

A ruleset comes from a repository that others can write to, so it has to be plain data: custom functions, and extending a ruleset from npm, a file or a URL, aren't supported.

## Generate requests

**Generate Request Collection**, in the Design tab, makes a request for each of the spec's operations, in folders by tag. Their URLs start with `{{ _.base_url }}`, set in the environment from the spec's servers.
