# Security checks

The response pane's **Security** tab lists what a response says about the security of the API that sent it. The number on the tab is how many things it found, with what the [tests](#security-tests) found once they've been run; it's red when one of them is high, and orange when one is medium.

Each finding has a severity (high, medium, low or info), what it was found in, why it matters, and the risk it comes under in the [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/).

## What it looks for

In transit:

- A request sent over plain http (high when it carried credentials). Hosts on this computer or a private network are left alone.
- A connection made with SSL 3, TLS 1.0 or TLS 1.1.
- No `Strict-Transport-Security` header over https.

Credentials:

- A credential in the URL: a user name and password, or a query parameter such as `token` or `api_key`.
- A JSON Web Token, in the request's `Authorization` header or the response's body, that is unsigned (`alg` is `none`) or has no expiry.

Headers and cookies:

- No `X-Content-Type-Options: nosniff`.
- CORS that allows any origin with credentials, or the `null` origin.
- Headers that name the server's software: `Server` with a version, `X-Powered-By`, `X-AspNet-Version`.
- An authenticated GET whose response a shared cache may keep (no `no-store`, `private` or `no-cache`).
- An HTML page without a `Content-Security-Policy`, or anything to stop it being framed.
- A cookie set without `Secure`, `HttpOnly` or `SameSite`.

The body:

- A stack trace or a database error.
- JSON fields that look sensitive and have a value, such as `password`, `passwordHash`, `secret`, `ssn` or `cardNumber`.

The findings name headers, cookies, parameters and fields, never a credential's value.

## What it can't tell you

It looks at the one request and response, and sends nothing more to find out. So it can't show what takes trying the API: whether one user can read another's data, whether a rate limit holds, whether an old version of the API is still up. A response with nothing found is one with none of the problems above, not a secure API.

Some of that the tests below can show.

In a design document, the tab also compares the request with the spec, under **Against the spec**: it names the operation that describes the request, or reports the request as one the spec doesn't describe (API9 Improper Inventory Management). Nothing is sent to tell.

## Security tests

Under the findings, **Run Security Tests** tries the API. It sends the request again, changed a little each time, and compares each answer with the request's own:

| Sent | Found when | Risk |
| --- | --- | --- |
| Without its credentials | the answer is the same | API2 Broken Authentication |
| With its JSON Web Token's signature changed | the answer is the same | API2 Broken Authentication |
| With its JSON Web Token made unsigned (`alg` set to `none`) | the answer is the same | API2 Broken Authentication |
| As another user | they get the same answer | API1 Broken Object Level Authorization |
| With less privilege | it's answered rather than refused | API5 Broken Function Level Authorization |
| With an `Origin` of another site | the answer allows that origin, with credentials | API8 Security Misconfiguration |
| Over plain http, without credentials | it answers rather than refusing or redirecting | API8 Security Misconfiguration |
| With a quote added to a query parameter (the first 3) | the answer shows a database error or a stack trace, or is a 5xx | API8 Security Misconfiguration |
| 100 times in a row (or as many as you set) | no answer is a 429 or has rate limit headers | API4 Unrestricted Resource Consumption |

Each test is listed with what was sent and what came back: found, passed, not run (with why) or unclear. Unclear means the answer was neither the same nor a refusal, so it's for you to look at.

To test as another user, choose an environment in **As another user** that holds that user's credentials. The request is sent to the same URL as before, with the other environment's auth and headers: the first user's data, asked for by the second.

**With less privilege** is for a request that only some users may make: an admin's report, say. Choose an environment whose user may *not* make it. Choosing one is what says the request is restricted, so anything but a refusal is a finding: high when the answer is the same as with full privilege, medium when it's another answer. Leave it at **Not tested** for a request every user may make.

### Marking what only some users may call

A request or a folder can be marked **Only Some API Users May Call It**, from its menu in the sidebar; **Every API User May Call It** takes the mark off. A folder's mark covers everything in it. Marked requests and folders show a person with a shield, and the mark is the collection's, so a team shares it.

The mark is about the API, not about Insomnium: it says the API is meant to refuse some of its users here, so the security checks try it as one of them. It doesn't limit who can open, edit or send the request, and anyone who can edit the collection can set it or take it off.

- The Security tab of a marked request says so, and asks for the environment to try it with.
- **Security Checks** over a collection tries less privilege on the marked requests alone, and leaves the rest as they are. It says how many are marked before it starts, and afterwards if any went untried because no environment was chosen.
- With nothing marked, choosing the environment says the run's requests are restricted: run it on the folder that holds them.

### The rate limit burst

**Rate limit burst** is how many times in a row the request is sent, looking for a rate limit: 100 unless you change it, 1000 at most. The test stops at the first 429, and sends nothing when the answers already have rate limit headers.

A limit above the burst doesn't show, so set it past the limit you expect: an API that allows 300 a minute needs more than 300. The result says how many were sent and how long they took. A limit counted over a longer time than the burst lasts won't show either.

Set it to 0 to leave the test out, for an API where that many requests cost something.

Things to know before running them:

- **Only test an API you're allowed to test.** The app asks before each run, and says how many requests it may send: 111 at most with the usual burst.
- **Only a GET or HEAD request is tested.** Anything else would change things once more for every test.
- **Nothing they send is kept:** no response in the history, no cookie in the jar. The results stay until the app closes.
- **A test that passes found nothing this once.** It doesn't show the API is secure.
- **The same answer isn't always a problem.** Data that is public, or shared by every user, answers the same to anyone.

For the API's design, a [design document](design-documents.md#owasp-api-security-rules) can be checked against the OWASP API Security rules.

## A whole collection

**Security Checks**, in a collection's menu and in a folder's, does this for every HTTP request in it, in the sidebar's order:

- A GET or HEAD is tested, and its answer looked at as the Security tab would.
- Any other request is never sent. It gets what its last response showed, or a note that it has none yet: send it once first.
- An event stream isn't sent.

The dialog says how many requests it may send before it starts (111 for each GET and HEAD at most, with the usual [rate limit burst](#the-rate-limit-burst), which the dialog can change), and its Run button is the go-ahead. **As another user** and **With less privilege** work as they do for one request. Closing the dialog, or **Stop**, ends the run where it is.

Each request is listed with what was found; its name opens it. The rules the collection ignores are left out.

For a design document, the requests are also compared with its spec, which sends nothing:

- A request the spec doesn't describe (its path, or its method on that path) is a finding, under API9 Improper Inventory Management. An endpoint that isn't in the spec isn't reviewed or linted with the rest; add it, or retire it if it's left over.
- The spec's operations that no request covers are listed under the results. The checks didn't reach those.

A request is matched to an operation by its method and path. Variables in the URL stand for anything, the spec's servers (or `basePath`) may come before the path, and so may a prefix the spec doesn't name, such as a gateway's.

A finished run saves as:

| Format | For |
| --- | --- |
| HTML | opening in a browser or attaching to a ticket: the same as the Markdown report, as one page that stands alone |
| Markdown | reading and passing on: the findings most severe first, what each means, and every request with its tests |
| JSON | the run as it is |
| SARIF | tools that take code scanning results. An API has no file to point at, so each result is located at its request |

A report names where a credential was, never the credential, and shows URLs without their query's values.

## In CI

[`insomnium-server security`](../packages/insomnium-server/README.md#security-checks-in-ci) is the same run without the app, for a pipeline: it exits 1 when it finds something as severe as `--fail-on`, and writes the same reports. With `--baseline`, an earlier run's report, it fails on new findings alone and lists the rest as known. With nobody to ask, the go-ahead is on its command line: `--i-may-test-this-api`.

## Ignoring a rule

Not every finding is a problem for every API: one that no browser calls has little use for `nosniff`, and a public one answers the same to everyone. **Ignore**, beside a finding, stops that rule's findings being shown in the collection, for every request in it. They no longer count on the tab.

The rules a collection ignores are listed at the bottom of the tab, each with **Show Again**. The list is the collection's own: it's in an export, and with Git Sync or a team server everyone working on the collection ignores the same rules. `insomnium-server security` leaves them out too, and says which they are before it starts.

An ignored test still runs and is still listed with what came back; only its finding is left out.

## From an AI agent

The MCP tool `audit_response` gives the same findings for a response, by its id or as a request's most recent.

`audit_response` and `run_security_tests` leave out the rules the collection ignores, and name them in `ignoredRules`.

`run_security_checks` runs them over a workspace or folder. `run_security_tests` runs the security tests on a request, and takes `otherEnvironmentId` for the other user. The app asks you to allow each run, with **Don't Run** the default. The headless server doesn't have it, having nobody to ask.
