# Fuzzing a request

**Fuzz**, in a request's menu in the sidebar, sends the request many times, each time with one value swapped for a payload, and compares every answer with the request's own. It's the way to find what the [security checks](security-checks.md) don't try: what a parameter does with a quote, a field with the wrong type, a body with a field that shouldn't be settable.

It works on any HTTP request, including ones that change data. **Run it only against an API you're allowed to test.**

## Where the payloads go

The dialog lists the places in the request a value can go, as the request would be sent now, with its variables filled in:

- each query parameter, from the Query tab or written in the URL
- each part of the URL's path
- each header, apart from the ones that describe the body or the connection
- each value in a JSON body, however deep, or each field of a form
- **a new field**, added to a JSON body that is an object

The likely ones are ticked: the query, the body, and the parts of the path that look like ids.

## What goes in them

| List | |
| --- | --- |
| SQL | quotes and fragments that break a query built from the value |
| NoSQL | operators a document database takes in place of a value |
| Paths | ways out of the folder a file or key is read from |
| Markup and templates | what a page or a template engine would run |
| Commands | fragments a shell would run |
| Other ids | ids that aren't the caller's: other records, none, and the edges |
| Odd values | the wrong type, nothing, and far too much |
| Fields to slip in | fields a caller shouldn't be able to set, such as `role` or `isAdmin` (mass assignment) |

**Your own** payloads go in the box, one a line. A line that is JSON (`null`, `{"$gt":""}`) goes into a JSON body as that value and not as text. A line like `role=owner` is a field to slip in.

Fields to slip in go only in the body's new field, and nothing else goes there.

**Positions** says how the payloads are spread over the places you ticked:

| | |
| --- | --- |
| One at a time | each position gets each payload while the rest of the request stays as it is. It shows which input is at fault, and is where to start |
| All at once | each payload goes in every position together: far fewer requests, and for values that must match, such as a field and its confirmation |
| Every combination | each mix of payloads over the positions, for what only breaks when two inputs are odd at once. Two positions with 24 payloads each is 576 attempts, and a third makes it 13,824, so tick few positions and short lists |

The dialog says how many requests that comes to before anything is sent, and a run sends 2000 at most.

## What it shows

The request is sent once as it is, then once for each attempt. Each row has the answer's status, size and time, and what stood out:

- the server failed (a 5xx where the request itself got none)
- the answer shows a stack trace or a database error
- a template was worked out (`{{7*7}}` came back as 49)
- a field slipped in came back as sent
- the attempt took far longer
- one of the request's own checks failed

Those are **worth a look**, and are shown first. Smaller differences are noted without being called that: another status, another size, a value that came back as it was sent. A row opens to show the start of the answer.

An attempt that stood out is a place to look, not a proven fault; one that didn't found nothing this once.

The attempts save as CSV or JSON.

## With the request's scripts

The request's [scripts](scripts.md) run for every attempt, as they do when you send it, and are told what's being tried:

| Variable | |
| --- | --- |
| `fuzzPayload` | the payload, as text. With several in one attempt, joined with ` + ` unless they're all the same |
| `fuzzPosition` | where it went, as the dialog names it. With several, joined with ` + ` |
| `fuzzAttempt` | the attempt's number; 0 for the request as it is |

```js
const payload = insomnia.iterationData.get('fuzzPayload');
```

That makes the scripts the place for what's particular to your API:

- **A pre-request script** can sign the request after the payload is chosen, or fetch a fresh token.
- **An after-response script's tests say what counts.** A test that fails marks the attempt as worth a look: `insomnia.test('no admin role', () => insomnia.expect(insomnia.response.json().role).to.not.equal('admin'))`.
- **An after-response script can clean up.** A POST that is fuzzed makes a record for every attempt the server accepts; the script can delete what the answer says was made.

[Assertions](testing.md) count the same way: one that fails marks the attempt.

## From an MCP client

Two tools do what the dialog does, for a client connected to the app:

- `list_fuzz_points` lists a request's positions and the payload lists. It sends nothing.
- `fuzz_request` runs a fuzz: positions by id or label (the likely ones when left out), lists by id, and your own payloads. It returns the attempts that stood out with the start of each answer, and the rest in brief.

The app asks you before each run, and says how many requests it sends, where the payloads go and whether the request changes data. A run you decline sends nothing.

## In CI

[`insomnium-server fuzz`](../packages/insomnium-server/README.md#fuzz-a-request-in-ci) fuzzes one request without the app, for a pipeline, and exits 1 when an attempt stood out. With nobody to ask, the go-aheads are on its command line: `--i-may-test-this-api`, and `--i-may-change-data` for a request that isn't a GET or HEAD.

## What to know before running it

- **A request that changes data changes it once per attempt.** The dialog asks you to say that you're allowed to, and that what's made or changed can be put right, before it will send a request that isn't a GET or HEAD.
- **Nothing sent is kept:** no response in the history, no cookie in the jar.
- **It sends one request at a time**, with a pause between them if you set one.
- **Stop**, or closing the dialog, ends the run where it is.
