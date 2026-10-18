# Mock server

A collection's mock server answers as its requests would, with their [examples](getting-started.md#requests): for a front end to develop against before the API exists, for tests that shouldn't reach a real service, or to show an API to someone.

## Start one

**Mock Server**, in the collection's menu, lists the requests it can answer for (those with examples), then **Start** runs it on the port you choose (4040 by default). It listens on this computer only, at `http://127.0.0.1:<port>`. The dialog shows each request it answers, live. It runs until you stop it or quit.

## How it answers

- A request matches a saved request by **method** and **path**. The saved URL's scheme, host, and any `{{ base_url }}` in front are ignored. `:id` path parameters and `{{ variables }}` match any one segment, and a path with more fixed segments wins: `/pets/mine` over `/pets/:id`.
- The **example** it answers with is the first success (2xx), or the first one if none is. A request can ask for another with Postman's headers: `x-mock-response-name: Not found`, or `x-mock-response-code: 404`.
- It answers with the example's status, headers and body. [Template tags](template-tags.md) in the body, `{{ variables }}` from the base environment and `{% faker %}` among them, are rendered on each answer, so imported Postman examples with `{{$randomEmail}}` vary.
- Pages on this computer (`localhost` or `127.0.0.1`, any port), such as a front end's dev server, may call it from the browser: it answers their CORS preflight requests and allows their origin. Other websites can't read its answers, since examples saved from real responses can hold real data. On `127.0.0.1` it also refuses requests that name another host, as a DNS-rebinding page would.
- When nothing matches, it answers 404 with a JSON body saying why.

Examples are read on each request, so editing one changes the next answer.

## Without the app

`insomnium-server mock` runs the same mock from an exported collection, in a container or CI:

```sh
docker run --rm -p 4040:4040 -v "$PWD:/work" -w /work \
  ghcr.io/yokomohoyo/insomnium-server mock --collection api.yaml --host 0.0.0.0
```

It prints the routes it answers, then each request. Options: `--collection` (repeat for more), `--port` (`INSOMNIUM_MOCK_PORT`, default 4040) and `--host` (`INSOMNIUM_MOCK_HOST`, default 127.0.0.1). It never sends requests itself.
