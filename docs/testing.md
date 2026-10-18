# Tests and the runner

## Assertions

A request's **Assertions** tab holds checks on its response, without writing code. Each has a source, sometimes a property, an operator and an expected value:

| Source | Property |
|---|---|
| Status code | |
| Header | The header's name |
| Body | |
| JSON path | A JSONPath expression into a JSON body, such as `$.items[0].id` |
| Response time (ms) | |

Operators: equals, does not equal, contains, does not contain, is greater than, is less than, exists, does not exist. Expected values can use [variables and tags](template-tags.md).

### Schemas

Two more operators check the body, or what a JSON path finds in it, against a JSON Schema:

- **matches JSON schema**: the expected value is the schema, such as `{"type": "object", "required": ["id"]}`.
- **matches the API spec**: the schema is the one the workspace's [API spec](design-documents.md) gives for the response. It finds the operation by the request's method and the path it went to (under one of the spec's servers, or its `basePath`), then the response by its status code, `2XX`, or `default`. It works with OpenAPI 3 and Swagger 2, and follows `$ref`s within the spec.

A failure lists what didn't match: `/id must be integer; the value must have required property 'name'`.

A schema can come with someone else's collection, so its regular expressions (`pattern` and `patternProperties`) aren't checked: a crafted one could hang the app. Formats (`email`, `date-time`…) aren't checked either.

Turn an assertion off with its checkbox to keep it without checking it.

## Script tests

An [after-response script](scripts.md#tests) can test anything else:

```js
insomnia.test('lists two pets', () => {
  insomnia.expect(insomnia.response.json().pets).to.have.lengthOf(2);
});
```

## Results

After a send, the response's **Tests** tab shows how many passed, then each assertion and script test, with what was found when one fails ("Status code equals 404: got 200"). Under it, **Console** shows what the request's scripts logged. The results are kept with the response, so the response history shows them too.

## Run a collection or folder

**Run Collection**, in the collection's menu, or **Run Folder**, in a folder's, sends its HTTP requests in order, as Send does, with the active environment, and checks their assertions and script tests.

- Untick requests to leave them out.
- **Iterations** runs the requests that many times.
- A **data file** (a CSV file with a header row, or a JSON array of objects) gives each iteration a row of variables, over the environment's. Rows are used in turn, and repeat when there are more iterations than rows. Scripts read the row with `insomnia.iterationData`.
- **Delay between requests**, in milliseconds.
- **Stop at the first request that fails** ends the run there.

Responses are kept as the run goes, so cookies, [`{% response %}`](template-tags.md#values-from-another-response) tags and values that scripts save to the environment carry from one request to the next.

Afterwards, save the results as a JUnit XML or JSON report.

## Load test

In the runner, choose **Load test** to send the chosen requests under load: each virtual user sends them in order, again and again, until the time is up.

- **Virtual users**, up to 100, send at the same time.
- **Duration**: how long the test runs.
- **Ramp-up** starts the users one after another over that time, rather than all at once.
- **Think time** is how long each user waits after each request.

While it runs, and when it's done, the runner shows how many requests were sent, how many a second, how many failed, and their latency (mean, 50th, 90th, 95th and 99th percentile, and the slowest) for each request and overall, with the status codes and the most common failures. A request fails when it can't be sent, answers 400 or above, or fails an assertion. **Save JSON** keeps the results.

Every request is sent as Send sends it, with its scripts, plugins and assertions, but responses aren't kept, so a long test doesn't fill your history or your disk. Load test only APIs you're allowed to.

To load test in CI, with thresholds that fail the build, use [`insomnium-server load`](../packages/insomnium-server/README.md#load-test-a-collection).

## Run a collection in CI

`insomnium-server run` is the same runner, without the app. It exits 1 when a request can't be sent or a check fails, and writes JUnit or JSON reports for your CI:

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work \
  -e INSOMNIUM_VAR_apiKey="$API_KEY" \
  ghcr.io/yokomohoyo/insomnium-server run --collection api.yaml --env staging --junit report.xml
```

Export the collection from Insomnium first (or use a Postman or Insomnia export). See [insomnium-server](../packages/insomnium-server/README.md#run-a-collection-in-ci) for every option.

## Unit tests

Collections and [design documents](design-documents.md) also have a **Test** tab: suites of unit tests, written with Chai, that send their requests. Make a suite with **New Test Suite**, add tests with **New Test**, and run them with **Run Tests**. In a test, `insomnia.send()` sends the request chosen for it and returns its response.

For new tests, prefer assertions and script tests: they work in any collection, in the runner and in CI.
