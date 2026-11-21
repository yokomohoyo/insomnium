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

For the API's design, a [design document](design-documents.md#owasp-api-security-rules) can be checked against the OWASP API Security rules.

## From an AI agent

The MCP tool `audit_response` gives the same findings for a response, by its id or as a request's most recent.
