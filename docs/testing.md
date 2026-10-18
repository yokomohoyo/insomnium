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
