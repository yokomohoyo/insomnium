# Event streams

An **Event Stream Request** connects to a Server-Sent Events (SSE) endpoint and shows what the server sends as it arrives: a live feed, progress updates, or a language model's reply as it's written.

## Connect

Add one with the **+** button above the sidebar, choosing **Event Stream Request**. It shows as **SSE** in the sidebar. It's an HTTP request that asks for `text/event-stream`, so it has the usual tabs: **Body**, **Auth**, **Query**, **Headers**, **Assertions**, **Scripts**, **Examples** and **Docs**, though scripts and assertions don't run for a stream (see below).

- It starts as a GET, but any method works. Many streaming APIs, model APIs among them, want a POST with a JSON body. The body can be text (JSON, XML and the like) or form URL-encoded, but not multipart or a file.
- Auth works as for any HTTP request: Bearer, Basic, API key, OAuth 1 and 2, AWS IAM, JWT and the rest.
- Variables and template tags work in the URL, headers and body.
- The proxy, the CA certificate and client certificates apply, as do the request's settings for redirects and cookies.

**Connect** (or Enter in the address) opens the stream, and **Disconnect** closes it. A dot by the request in the sidebar shows it's open.

## Read what arrives

The response pane shows the status, the time and the size, and these tabs:

- **Events**: what the server sent, newest first, with when each arrived. The first row says the stream connected, and the last that it closed. Each row is a piece of the stream as it came over the network, so one row can hold several events, or part of one. **Search** filters the rows, and the clear button hides the ones so far. Click a row to see it in full: **Preview** lays out JSON, and **Copy raw response** or **Export raw response** takes that row's data.
- **LLM**, when the stream is a language model's reply: the reply put together as it streams, the model, the tokens used, the time to the first token and to the whole reply (with tokens per second), why it stopped, and any reasoning it showed. It reads OpenAI-compatible chat completions (OpenAI, Ollama, LM Studio, vLLM, OpenRouter, Gemini's), OpenAI's Responses API and Anthropic's Messages API. To see the tokens from an OpenAI-compatible API, ask for them in the body, with `"stream_options": { "include_usage": true }`.
- **Headers**, **Cookies** and **Timeline**: the response's headers, the cookies it set, and the raw exchange.

Each connection is kept in the request's response history, events and all, so you can come back to an earlier one.

## Things to know

- **No reconnecting.** When the server ends the stream, it shows as closed. Insomnium doesn't reconnect by itself or send `Last-Event-ID`: **Connect** again for a new stream.
- **One at a time.** A request has one stream open at once.
- **Scripts, assertions and the runner.** The pre-request and after-response scripts and the assertions don't run for an event stream. The [runner](testing.md) leaves event streams out (they're listed as *not run*), and a load test won't take one.
- **From an agent.** An AI client connected to the [automation server](mcp-server.md) can open an event stream and read what it received.
