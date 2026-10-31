# Scripts

An HTTP request's **Scripts** tab holds two scripts, in JavaScript:

- The **pre-request** script runs before the request is rendered and sent. It can change the request, set variables for this send, and save values to the environment.
- The **after-response** script runs on the response. Its tests join the request's [assertions](testing.md) in the response's **Tests** tab, and it can save values from the response, such as a token or an id, for the next request.

```js
// pre-request
insomnia.environment.set('timestamp', Date.now());
insomnia.request.headers.upsert({ key: 'X-Trace', value: insomnia.variables.get('trace') });

// after-response
insomnia.test('is OK', () => insomnia.expect(insomnia.response.code).to.equal(200));
insomnia.environment.set('token', insomnia.response.json().token);
```

`pm` is the same API as `insomnia`, so common Postman scripts work as written. What a script logs with `console.log` (also `info`, `warn`, `error` and `debug`) is shown under **Console** in the Tests tab.

Scripts run when you send a request, in the [runner](testing.md#run-a-collection-or-folder), in `insomnium-server run`, and when an AI client sends a request [over MCP](mcp-server.md).

## The sandbox

Scripts run in [QuickJS](https://bellard.org/quickjs/), a JavaScript engine compiled to WebAssembly, apart from the rest of the app. A script has no Node, no DOM, no network and no file access: `require`, `process`, `fetch`, `window` and `setTimeout` don't exist. It gets the request, the response and the environments as data, and hands back its changes as data. So a script in a collection someone shared with you can change that collection's request and environment, and nothing else.

A script may run for 10 seconds and use 64 MB of memory. It can `await`, and its tests can be `async`.

If the pre-request script throws, the request isn't sent, and the error and its line are shown. If the after-response script throws, that shows up as a failed test.

## Variables and environments

| | |
|---|---|
| `insomnia.environment` | The environment in use: the sub environment, or the base one if none is chosen. |
| `insomnia.baseEnvironment` | The base environment. `collectionVariables` is the same store, for scripts from Postman. |
| `insomnia.globals` | The project's [global environment](getting-started.md#global-environments) in use: the global sub environment the collection uses, or else the global base environment. |
| `insomnia.variables` | Variables for this send only. `get` looks here first, then in the iteration data, the environment, the base environment and the globals. |
| `insomnia.iterationData` | The [runner](testing.md)'s current data row, read-only. |

Each has `get(name)`, `has(name)`, `toObject()` and `replaceIn(text)`. All but `iterationData` also have `set(name, value)`, `unset(name)` and `clear()`. `replaceIn('{{host}}/users')` fills in the variables it knows and leaves the rest.

Values set in the environments are saved. Values set in `variables` are used to render this request (`{{ name }}`) and then dropped.

## The request

In the pre-request script, `insomnia.request` can be changed. In the after-response script it can be read, and changing it is an error.

| | |
|---|---|
| `method` | `'GET'`, `'POST'`… |
| `url` | The URL. `url.toString()` includes the query; `url.getHost()` and `url.getPath()` give its parts. Assign a string to replace it (a `?query` in it becomes the query parameters). |
| `url.query` | The query parameters, with the same methods as `headers`. Also `url.addQueryParams(['page=2'])` and `url.removeQueryParams(['page'])`. |
| `headers` | `get(name)`, `has(name)`, `all()`, `each(fn)`, `toObject()`, `add({ key, value })`, `upsert({ key, value })` and `remove(name)`. Names match without case. |
| `addHeader({ key, value })`, `removeHeader(name)` | The same, for Postman scripts. |
| `body` | `body.raw` is the body as text; `body.mode` is `'raw'`, `'urlencoded'`, `'formdata'`… `body.update(text)` replaces it. |

`insomnia.info` has `eventName` (`'prerequest'` or `'test'`), `requestName`, `requestId` and `iteration` (the runner's, from 0).

## The response

In the after-response script:

| | |
|---|---|
| `insomnia.response.code` | The status code, `200`. |
| `.status` | The status text, `'OK'`. |
| `.responseTime` | In milliseconds. |
| `.responseSize` | The length of the body. |
| `.headers` | As the request's: `get`, `has`, `all`, `toObject`… |
| `.text()` | The body as text. |
| `.json()` | The body parsed as JSON. It throws if the body isn't JSON. |

And Postman's checks, which pass or throw:

- `insomnia.response.to.have.status(201)`, or the status text.
- `.to.have.header('Content-Type')`, optionally with a value.
- `.to.have.body()`, optionally with the text (or an object, compared as JSON), and `.to.have.jsonBody()`.
- `.to.be.ok` and `.to.be.success` (2xx), `.redirection` (3xx), `.clientError` (4xx), `.serverError` (5xx), `.error` (4xx or 5xx), `.notFound` (404).

## Tests

```js
insomnia.test('returns the user', () => {
  const user = insomnia.response.json();
  insomnia.expect(user).to.have.property('name', 'Tom');
  insomnia.expect(user.tags).to.include('admin').and.to.have.lengthOf(2);
});

insomnia.test('later', async () => {
  await somethingAsync();
});

insomnia.test.skip('not yet', () => {});
```

A test passes if its function returns, or its promise resolves, and fails with the error it throws. `insomnia.expect(value, message)` is like Chai's `expect`:

- Chains: `to`, `be`, `been`, `is`, `that`, `which`, `and`, `has`, `have`, `with`, `at`, `of`, `same`, `but`, `does`, `still`, `also`; `not` negates; `deep` compares by value.
- Flags: `.ok`, `.true`, `.false`, `.null`, `.undefined`, `.NaN`, `.exist`, `.empty`.
- `equal(x)` (`eq`, `equals`), `eql(x)` (deep), `above(n)` (`gt`, `greaterThan`), `below(n)` (`lt`, `lessThan`), `least(n)` (`gte`), `most(n)` (`lte`), `within(low, high)`.
- `a(type)` and `an(type)`: `'string'`, `'number'`, `'object'`, `'array'`, `'null'`…
- `include(x)` (`contain`, `includes`, `contains`), `property(name, value?)`, `lengthOf(n)` (`length`), `match(regex)` (`matches`), `oneOf(list)`, `keys(...)`, `string(text)`, `satisfy(fn)`.

`insomnia.expect.fail(message)` fails at once.

## Visualize a response

An after-response script can show the response its own way, as a table or a chart, in the response's **Visualize** tab. `insomnia.visualizer.set(template, data)` (or `pm.visualizer.set`, as in Postman) takes a [Handlebars](https://handlebarsjs.com) template and the data to fill it with:

```js
const template = `
  <table>
    <tr><th>Name</th><th>Email</th></tr>
    {{#each users}}<tr><td>{{name}}</td><td>{{email}}</td></tr>{{/each}}
  </table>`;

insomnia.visualizer.set(template, { users: insomnia.response.json() });
```

Scripts in the template get the data with `pm.getData((error, data) => …)`. `insomnia.visualizer.clear()` removes what was set.

A visualization can't reach the network: not to send the response anywhere, and not to load a library either. Put the scripts and styles it needs in the template. The template and data together can be up to 1 MB.

## Imported scripts

Scripts from [Postman, and from Insomnia's v4 and v5 exports](import-export.md), are imported as the requests' scripts. A collection's or folder's scripts, which those apps run before each request's, are copied into each request under them, each part in a function of its own. A Postman API call Insomnium doesn't have yet, such as `pm.sendRequest`, fails with a `TypeError` and its line.

## Not yet

- Sending other requests from a script (`insomnia.sendRequest`).
- Scripts on folders and collections of their own.
- Scripts for gRPC, WebSocket and Event Stream requests.
