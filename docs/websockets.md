# WebSocket, Socket.IO and MQTT

A **WebSocket Request** keeps a connection open to send messages and see what comes back. It can also speak three protocols that run over a WebSocket: [GraphQL subscriptions](#graphql-subscriptions), [Socket.IO](#socketio) and [MQTT](#mqtt).

## Connect

Add one with the **+** button above the sidebar, choosing **WebSocket Request**, and enter the address, such as `wss://example.com/chat` (`ws://` for an unencrypted one).

- **Query** and **Headers** go with the opening request, and **Auth** adds an API key, Basic or Bearer auth to it. Variables and template tags work in all of them.
- To ask for a subprotocol, add a `Sec-WebSocket-Protocol` header.
- The proxy, the CA certificate, client certificates and certificate validation apply, as for HTTP.

**Connect** opens it. **Disconnect** closes it, and its menu has **Disconnect all requests**. While it's open, the connection's settings are locked; disconnect to change them.

## Send messages

Write a message in the editor and **Send** it; if a plain WebSocket isn't connected yet, Send connects first (for Socket.IO and MQTT, **Connect** first). Choose its format from the mode menu (where **JSON** is):

- **JSON** or **Raw** for a text frame.
- **Hex (binary)** or **Base64 (binary)** for a binary frame. Hex may be spaced, split by `:`, or have `0x` before each byte, as copied from a dump.

**Save Message** keeps the one in the editor with the request, under a name, and **Saved messages…** puts one back, to send again. They're part of the collection, so they're exported and synced with it.

## Read what comes back

The response pane's **Events** lists what was sent and received, newest first, with the time of each. Filter it by type (**All**, **Message**, **Open**, **Close**, **Error**) or with **Search**, and clear it with the clear button. Click a message to see it in full.

A binary frame shows its size and first bytes. Open it for a hex dump (**Preview**), base64 (**Source**) or the bytes as text (**Raw**), and save it as the bytes themselves.

**Headers**, **Cookies** and **Timeline** show the opening exchange, the cookies it set, and the connection's log, reconnects included.

## Reconnect

To reconnect when a connection drops, open the request's settings and turn on **Reconnect when the connection drops**, with the **Seconds between attempts** (3 to start with) and the **Attempts in a row** (10).

- It reconnects into the same response, so the event log carries on.
- It stops after that many failed attempts, but a connection that stays open for 10 seconds starts the count again.
- It never reconnects after you disconnect, or when the server answers with HTTP (such as a 401) instead of opening a WebSocket. Disconnect while it's waiting to stop it.

## GraphQL subscriptions

The **GraphQL** tab runs a GraphQL subscription. Turn on **Subscribe when connected**, write the subscription and its **Variables** (a JSON object), and **Connect**.

It speaks the `graphql-transport-ws` protocol, which Apollo, Hasura, GraphQL Yoga and others use. Each event comes in as a message, and the connection closes when the subscription completes. The older `subscriptions-transport-ws` protocol isn't supported. For queries and mutations, use a [GraphQL request](graphql.md).

## Socket.IO

The **Socket.IO** tab makes the request a Socket.IO client, for Socket.IO 3 and 4. Turn on **Use Socket.IO**, give the server's address (such as `http://localhost:3000`), a **Namespace** (`/` to start with) and any **Auth** to send when connecting, as JSON, and **Connect**.

The message editor then sends an event: name it in **Event**, and the JSON is its argument (an array gives several arguments). The server's events, and its heartbeats, show in the event log.

It connects over WebSocket only, without long polling, and binary attachments aren't supported.

## MQTT

The **MQTT** tab makes the request an MQTT 3.1.1 client, over a broker's WebSocket listener, such as `ws://localhost:8080` for Mosquitto's or `ws://broker.hivemq.com:8000/mqtt`. Turn on **Use MQTT** and give:

- a **Client ID**, or leave it empty for a new one each connection;
- a **User name** and **Password**, if the broker wants them;
- **Keep alive (s)**, 30 to start with;
- the topics to subscribe to, a line each with its QoS after it, such as `sensors/+/temperature 1`.

**Connect** connects and subscribes. The message editor then publishes to the **Topic** by it, at **QoS 0** or **QoS 1**, and **Retain** if you like. Deliveries show in the event log as `topic: payload`, and QoS 1 ones are acknowledged.

MQTT over plain TCP (port 1883), QoS 2 and MQTT 5 aren't supported yet.

## Things to know

- **No ping or close code of your own.** Insomnium doesn't send pings on a plain WebSocket, and Disconnect closes without a code. The GraphQL, Socket.IO and MQTT clients answer their protocol's pings and keep-alives themselves.
- **Scripts, assertions, the runner and flows** are for HTTP requests; they don't run WebSocket requests.
- **From an agent.** An AI client connected to the [automation server](mcp-server.md) can connect, read and close with any of them, and send on a plain WebSocket; Socket.IO events and MQTT publishes go from the app's editor. The app's window shows the same connection.
