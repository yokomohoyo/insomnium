# Security checks

The response pane's **Security** tab lists what a response says about the security of the API that sent it. The number on the tab is how many things it found; it's red when one of them is high, and orange when one is medium.

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

## Security tests

Under the findings, **Run Security Tests** tries the API. It sends the request again, changed a little each time, and compares each answer with the request's own:

| Sent | Found when | Risk |
| --- | --- | --- |
| Without its credentials | the answer is the same | API2 Broken Authentication |
| With its JSON Web Token's signature changed | the answer is the same | API2 Broken Authentication |
| With its JSON Web Token made unsigned (`alg` set to `none`) | the answer is the same | API2 Broken Authentication |
| As another user | they get the same answer | API1 Broken Object Level Authorization |
| With an `Origin` of another site | the answer allows that origin, with credentials | API8 Security Misconfiguration |
| Over plain http, without credentials | it answers rather than refusing or redirecting | API8 Security Misconfiguration |
| With a quote added to a query parameter (the first 3) | the answer shows a database error or a stack trace, or is a 5xx | API8 Security Misconfiguration |
| 15 times in a row | no answer is a 429 or has rate limit headers | API4 Unrestricted Resource Consumption |

Each test is listed with what was sent and what came back: found, passed, not run (with why) or unclear. Unclear means the answer was neither the same nor a refusal, so it's for you to look at.

To test as another user, choose an environment in **As another user** that holds that user's credentials. The request is sent to the same URL as before, with the other environment's auth and headers: the first user's data, asked for by the second.

Things to know before running them:

- **Only test an API you're allowed to test.** The app asks before each run, and says how many requests it may send (25 at most).
- **Only a GET or HEAD request is tested.** Anything else would change things once more for every test.
- **Nothing they send is kept:** no response in the history, no cookie in the jar. The results stay until the app closes.
- **A test that passes found nothing this once.** It doesn't show the API is secure, and 15 requests are too few to reach most rate limits.
- **The same answer isn't always a problem.** Data that is public, or shared by every user, answers the same to anyone.

For the API's design, a [design document](design-documents.md#owasp-api-security-rules) can be checked against the OWASP API Security rules.

## From an AI agent

The MCP tool `audit_response` gives the same findings for a response, by its id or as a request's most recent.

`run_security_tests` runs the security tests on a request, and takes `otherEnvironmentId` for the other user. The app asks you to allow each run, with **Don't Run** the default. The headless server doesn't have it, having nobody to ask.
