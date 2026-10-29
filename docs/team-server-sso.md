# Team Server Single Sign-On

A [team server](../packages/insomnium-server/README.md#share-collections-with-a-team) can let people sign in through your organization's identity provider, with OpenID Connect, instead of a password it keeps. This page walks through setting that up with a Synology NAS's SSO Server, then the same steps for a few other providers.

Whichever provider you use, the steps are the same:

1. Serve the team server over HTTPS, and set `INSOMNIUM_TEAM_URL` to its address.
2. Register the team server at the provider as a confidential client (one with a secret), with the redirect URL `<INSOMNIUM_TEAM_URL>/auth/oidc/callback`.
3. Give the team server the provider's issuer URL, the client's id and secret, and the claim that names each person's account.
4. Restart it, and choose **Sign In with SSO** in the app's **Team Server** tab.

## Synology SSO Server

Synology's **SSO Server** package (DSM 7.1 and later) is an OpenID Connect provider for the NAS's own accounts, or the accounts of a directory it's joined to. It can run on the same NAS as the team server.

### 1. Serve both over HTTPS

The team server and SSO Server both need an HTTPS address that people's computers can reach, and that the team server's container can reach too: it fetches the provider's settings and keys, and trades the sign-in's code for a token, itself.

- **A certificate.** In **Control Panel → Security → Certificate**, use one the computers already trust, such as Let's Encrypt for your `synology.me` or own domain. The team server refuses a self-signed one. If you must use your own certificate authority, mount its certificate into the container and set `NODE_EXTRA_CA_CERTS` to its path.
- **The team server.** Add a reverse proxy rule in **Control Panel → Login Portal → Advanced → Reverse Proxy**: from `https://nas.example.com:8443` to `http://localhost:8080`. Set `INSOMNIUM_TEAM_URL=https://nas.example.com:8443`.
- **From inside the container,** `nas.example.com` has to reach the NAS. If it resolves to your router's public address and the router doesn't loop that back, add `--add-host nas.example.com:<the NAS's LAN address>` to the container.

### 2. Set up SSO Server

Install **SSO Server** from the Package Center, and open it.

1. **General Settings**: set **Server URL** to the NAS's HTTPS address, such as `https://nas.example.com` (with its port, if DSM isn't on 443). The issuer the provider reports is made from this address, so if it's `http://`, sign-ins fail with "The provider says it is http://…".
2. **Account Type**: the NAS's own (local) accounts, or Domain/LDAP for a directory the NAS is joined to.
3. **Service → OIDC**: turn on the OIDC service. Note its **Well-known URL**, such as `https://nas.example.com/webman/sso/.well-known/openid-configuration`.

### 3. Register the team server

In **Application**, choose **Add**, then **OIDC**:

- **Name**: Insomnium, or anything you like. People see it on the sign-in page.
- **Redirect URI**: `https://nas.example.com:8443/auth/oidc/callback`, your `INSOMNIUM_TEAM_URL` followed by `/auth/oidc/callback`, with the port.

Save it, and note the **Application ID** and **Application Secret**.

### 4. Configure the team server

Run the team server with these variables, alongside the ones it already has:

```sh
docker run -d --name insomnium-team --restart unless-stopped \
  -p 8080:8080 \
  -v /volume1/docker/insomnium-team:/data \
  -e INSOMNIUM_TEAM_ADMIN=kim \
  -e INSOMNIUM_TEAM_URL=https://nas.example.com:8443 \
  -e INSOMNIUM_TEAM_OIDC_ISSUER=https://nas.example.com/webman/sso \
  -e INSOMNIUM_TEAM_OIDC_CLIENT_ID=<Application ID> \
  -e INSOMNIUM_TEAM_OIDC_CLIENT_SECRET=<Application Secret> \
  -e INSOMNIUM_TEAM_OIDC_USERNAME_CLAIM=username \
  -e INSOMNIUM_TEAM_OIDC_NAME=Synology \
  ghcr.io/yokomohoyo/insomnium-server team
```

In Container Manager, these go under the container's **Environment** settings. To change them on a container that's already there, stop it, edit its settings, and start it again; the data on `/data` stays as it is.

- **`INSOMNIUM_TEAM_OIDC_ISSUER`** is the Well-known URL without `/.well-known/openid-configuration`. It has to match the `issuer` in that document exactly, `https://` included. Open the Well-known URL in a browser to check.
- **`INSOMNIUM_TEAM_OIDC_USERNAME_CLAIM=username`**: Synology sends the DSM account's name in the `username` claim. It doesn't send `preferred_username`, the default. It doesn't say whether an email address is verified, either, so `email` won't work with it.

### 5. Accounts

Each person's first sign-in claims the team server account with the same name as their DSM account. So either:

- add the accounts first (`team user add lee`, or in the API), with the same names as in DSM, and give them their roles; or
- set `INSOMNIUM_TEAM_OIDC_CREATE_USERS=true`, so anyone who can sign in to the NAS gets an account on their first sign-in, with no collections until someone adds them to one.

Account names on the team server are lower case letters, digits, `.`, `_` and `-`. A DSM name with other characters, such as a directory account's `lee@example.com`, can't be claimed.

To keep the team server to some of the NAS's people, don't turn on account creation: only those with an account can sign in. SSO Server can also limit who may use each application to some users or groups.

### 6. Sign in

In Insomnium, open **Git Clone**, then the **Team Server** tab. Choose **Sign in to a team server…**, enter `https://nas.example.com:8443`, and click **Sign In with SSO**. Your browser opens the NAS's sign-in page. After you sign in, the browser says you can close the tab and go back to Insomnium, which has signed in.

For git on the command line, open `https://nas.example.com:8443/auth/oidc/start` in a browser. After you sign in, it shows a new access token once: use it as the password, with your user name.

## Other providers

The redirect URL is always `<INSOMNIUM_TEAM_URL>/auth/oidc/callback`, and the client is a confidential one, with a secret, using the authorization code flow.

| Provider | Register the client in | `INSOMNIUM_TEAM_OIDC_ISSUER` | `…_USERNAME_CLAIM` |
|---|---|---|---|
| Authentik | **Applications → Providers**, an **OAuth2/OpenID Provider** with client type **Confidential**, then an application that uses it | `https://authentik.example.com/application/o/<application slug>/` | `preferred_username` (the default) |
| Keycloak | **Clients → Create client**, OpenID Connect, with **Client authentication** on and **Standard flow** | `https://keycloak.example.com/realms/<realm>` | `preferred_username` (the default) |
| Google | **Google Auth Platform → Clients**, a **Web application** client | `https://accounts.google.com` | `email` (the part before the @ names the account) |

The issuer is the address whose `/.well-known/openid-configuration` the provider serves, and must match the `issuer` in it.

## When it doesn't work

Insomnium shows why, and so does the team server's log (`docker logs insomnium-team`). The common reasons:

- **"The provider says it is …, not …"**: `INSOMNIUM_TEAM_OIDC_ISSUER` isn't the issuer in the provider's Well-known URL. Copy it from there. On a Synology, check that SSO Server's **Server URL** is the `https://` one.
- **The provider says the redirect URI is wrong**: the redirect URL registered at the provider must be exactly `<INSOMNIUM_TEAM_URL>/auth/oidc/callback`, with the same scheme, host and port. Check `INSOMNIUM_TEAM_URL` too.
- **"The provider answered 401: invalid_client"**: the client id or secret is wrong.
- **"The provider didn't send the … claim"**: the ID token has no claim by that name. The team server reads the name from the ID token, not the userinfo endpoint. Set `INSOMNIUM_TEAM_OIDC_USERNAME_CLAIM` to one it has (`username` on a Synology), or have the provider add it to the ID token.
- **"Couldn't reach …" or a certificate error**: the container can't reach the provider at that address, or doesn't trust its certificate. See [Serve both over HTTPS](#1-serve-both-over-https).
- **"There's no account … here"**: with account creation off, an admin adds the account first, with the same name the claim gives.
- **"The ID token has expired" or "is from the future"**: the team server's clock and the provider's are more than two minutes apart. Turn on NTP on both.
