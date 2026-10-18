# Template tags

Anywhere in a request (URL, query, headers, body, auth) you can use:

- `{{ name }}`: a variable from the environment (see [Getting started](getting-started.md#environments)), or one a [pre-request script](scripts.md) set.
- `{% tag … %}`: a value computed when the request is sent.

Press Ctrl+Space in a field to pick a variable or a tag. Click a tag to edit its arguments and see what it renders to now. Tags can be nested in arguments, and work in environments too. A value that changes each time (a timestamp, a UUID) is computed again on each send.

## Built in

| Tag | What it gives |
|---|---|
| **Timestamp** `now` | The current time: ISO-8601, milliseconds, Unix seconds, or a custom format. An offset shifts it: `-30m`, `+2h`, `+7d` (`s`, `m`, `h`, `d`, `w`). |
| **UUID** `uuid` | A version 4 (random) or version 1 UUID. |
| **Random** `random` | An integer between a minimum and a maximum, a string of letters and digits or of hex digits of a given length, a boolean, or one of a list of choices. |
| **Faker** `faker` | Fake data by Postman's dynamic variable names: `randomFullName`, `randomEmail`, `randomUUID`, `randomInt`, `isoTimestamp` and many more. Postman's `{{$randomEmail}}` becomes this tag on import. |
| **Base64** `base64` | Encodes or decodes a value, in standard or URL-safe Base64. |
| **Hash** `hash` | MD5, SHA-1, SHA-256 or SHA-512 of a value, in hex or Base64. |
| **HMAC** `hmac` | Signs a value with a secret key: SHA-256, SHA-512, SHA-1 or MD5, in hex, Base64 or Base64 URL. |
| **JSON Web Token** `jwt` | A JWT signed with a shared secret (HS256, HS384, HS512), from a JSON payload, optionally expiring after a number of seconds. |
| **Environment Variable** `env` | An OS environment variable, or one from a dotenv file: see below. |
| **HashiCorp Vault Secret** `vault` | A field of a Vault KV secret (version 1 or 2): see [secrets](#secrets-from-a-secret-manager). |
| **1Password Secret** `onePassword` | A 1Password secret reference, `op://vault/item/field`. |
| **AWS Secret** `awsSecret` | An AWS Secrets Manager secret, or a field of a JSON one. |
| **Google Cloud Secret** `gcpSecret` | A Secret Manager secret, or a field of a JSON one. |
| **Azure Key Vault Secret** `azureSecret` | A Key Vault secret, or a field of a JSON one. |
| **OS** `os` | The computer's architecture, CPUs, free memory, hostname, platform, release or user info, optionally filtered with JSONPath. |
| **File** `file` | The contents of a file you choose. |
| **JSONPath** `jsonpath` | A value picked out of a JSON string with a JSONPath expression. |
| **Cookie** `cookie` | The value of a cookie in the collection's jar, for a URL and name. |
| **Prompt** `prompt` | Asks you for a value when the request is sent. It can be masked, like a password, and default to the last value given. |
| **Response** `response` | A value from another request's latest response: see below. |
| **Request** `request` | A value from the request being sent: its name, folder, URL, a query parameter, a header, a cookie, or its OAuth 2 access, identity or refresh token. |
| **GCP ID Token** `gcpIdToken` | A Google OIDC identity token for an audience, such as a Cloud Run or IAP-protected service, from application default credentials or a service account key. |

## Values from another response

The **Response** tag chains requests: for example, the token from a login request, put into the `Authorization` header of the next one.

Choose the request, then what to take from its latest response:

- **Body attribute**: a value from a JSON body by JSONPath (`$.token`), or from an XML body by XPath.
- **Raw body**, a **header** by name, or the **URL** it went to.

**Trigger behaviour** decides when the other request is sent first:

- **Never**: use its latest response.
- **No history**: send it if it has no response yet.
- **When expired**: send it again once its response is older than a number of seconds.
- **Always**: send it every time.

A [script](scripts.md) can do the same with `insomnia.environment.set('token', insomnia.response.json().token)` in the login request's after-response script.

## OS environment variables and dotenv

`{% env 'API_TOKEN' %}` reads `API_TOKEN` from the operating system's environment. A collection from someone else could otherwise send your variables anywhere, so the tag reads only the names you allow, in **Preferences → General → OS Environment Variables**:

- **Allowed names**: comma-separated names, or prefixes ending in `*`, for example `API_TOKEN, STAGING_*`. None are allowed until you list them.
- **dotenv file**: optionally, a `.env` file to read allowed names from when the OS environment doesn't set them. It's read on each send, so edits apply straight away.

On import, Bruno's `{{process.env.NAME}}` becomes `{% env 'NAME' %}`.

## Secrets from a secret manager

The secret tags read a secret when the request is sent, with credentials already on your computer, so the secret is never saved in the collection:

| Tag | Credentials |
|---|---|
| `vault` | `VAULT_ADDR`, and `VAULT_TOKEN` or the token the `vault` CLI saved (`~/.vault-token`); `VAULT_NAMESPACE` for Vault Enterprise. |
| `onePassword` | The 1Password CLI, `op`, installed and signed in. |
| `awsSecret` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` for temporary ones; the region as an argument or `AWS_REGION`. `AWS_ENDPOINT_URL_SECRETS_MANAGER` points it elsewhere, such as LocalStack. |
| `gcpSecret` | Application default credentials (`gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS`). |
| `azureSecret` | The Azure CLI, `az`, signed in. |

A collection from someone else could otherwise send your secrets anywhere, so a tag reads only the secrets you allow, in **Preferences → General → Secrets**. List references, or prefixes ending in `*`:

- `vault:secret/data/app`, for a Vault path;
- `op://Work/*`, for a 1Password vault;
- `aws:prod/*`, for AWS secret names;
- `gcp:projects/my-project/secrets/*`;
- `azure:my-vault/*`.

None are allowed until you list them. A secret is kept in memory for five minutes, so the tag's preview doesn't ask the secret manager on every keystroke.

## From plugins

[Plugins](plugins.md) can add tags of their own. They appear in the same list.
