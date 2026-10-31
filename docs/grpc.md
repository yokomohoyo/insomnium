# gRPC

A **gRPC Request** calls a gRPC service: unary calls, and server, client and bidirectional streams. It learns the service's methods from `.proto` files or from the server itself, by reflection.

## Set one up

1. Add one with the **+** button above the sidebar, choosing **gRPC Request**.
2. Enter the server's address, such as `grpcb.in:9000`.
   - `grpc://host:port` is plaintext and `grpcs://host:port` is TLS.
   - Without either, TLS is used for port `443`, Cloud Run (`*.run.app`) and Google APIs (`*.googleapis.com`), and plaintext otherwise. Write the scheme to be sure.
3. Load the methods, with one of the icon buttons by the address:
   - **Click to use server reflection**, for a server with reflection on. The **Headers** go with the reflection call but the **Auth** tab doesn't, so for a server behind auth put its token in a header.
   - **Click to change proto file**, which opens **Select Proto File** (below).
4. Pick a method from **Select Method**. Methods are grouped by package, as `/Service/Method`.

Picking a method fills the **Body** with a template of its request message, in JSON, as a start. Your own edits are kept when you pick again; the **Replace body with request template** button starts over.

## Proto files

**Select Proto File** keeps the collection's `.proto` files:

- **Add Proto File** adds one file, and **Add Directory** a folder of them, with their imports resolved. Google's well-known types (`google/protobuf/*`) are built in.
- **Import from URL** fetches them from GitHub (a file or a folder, `github.com/…/blob/…` or `…/tree/…`, or a raw URL), from any `https://` URL ending in `.proto`, or from the Buf Schema Registry (`buf.build/owner/repo`, with `:ref` for a branch, tag or commit).
- For private repositories, add a **Buf Schema Registry token** and a **GitHub personal access token** under **Preferences → Proto Tokens**. They're kept encrypted when a system keychain is available. **Workspace token overrides**, in **Select Proto File**, sets other tokens for this collection.

Updating a file stops the calls that use it. Deleting one leaves the requests that use it without their methods.

## Call it

The first tab is named after the method's kind: **Unary**, **Server Streaming**, **Client Streaming** or **Bi-directional Streaming**. Write the message in its **Body**, as JSON; variables and template tags work.

- **Unary** and **server streaming:** **Send** (or **Start** for a stream) sends the message, and the replies come in as they arrive. **Cancel** stops a call.
- **Client** and **bidirectional streaming:** **Start** opens the stream. **Stream +** sends what's in the body as the next message; each one sent shows as a **Stream** tab. **Commit →** ends your side, and the server finishes. **Cancel** stops it.

**Headers** holds the call's metadata, and **Auth** adds Bearer, Basic, API key, OAuth 2, JWT, Google Cloud ID tokens and others to it. Digest, NTLM, AWS IAM and netrc are in the menu but don't work for gRPC: a call with one stops with an error.

## The response

The status shows by the response: **OK** in green, or the error in red, with its code.

- A unary call shows its reply. A stream shows **Messages**, each with when it was received.
- **Metadata** shows the **Headers** and **Trailers** the server sent. Binary (`-bin`) values show as base64.

## TLS and proxies

Over TLS, Insomnium trusts the usual root certificates, the operating system's store if you turn that on in Preferences, and the collection's CA certificate. A client certificate for the host, from the collection's settings, is sent too, for mutual TLS. Turning off certificate validation in Preferences also turns it off for gRPC. An HTTP proxy set in Preferences is used.

## Things to know

- **No timeout.** A call runs until it finishes or you cancel it.
- **Scripts, assertions, the runner and flows** are for HTTP requests; they don't run gRPC calls.
- **From an agent.** An AI client connected to the [automation server](mcp-server.md) can send any of the four kinds with `send_grpc_request`, with a timeout (30 seconds unless it asks otherwise, up to 10 minutes) and a cap on how many replies it reads. It can also list and import proto files, see their methods, and set metadata.
