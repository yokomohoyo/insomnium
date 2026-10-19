# Flows

A flow sends a collection's requests in the order you draw them on a canvas. Between them it can check a response and go one way or the other, take a value from a response for the requests after, or wait. Log in, keep the token, then fetch with it; poll until a job is done; try the next request only when the last one worked.

Flows are under **Flows** at the top of a collection or design document, beside **Debug** and **Test**.

## Drawing a flow

**New Flow** makes one with its **Flow Start**, where it begins. Select a step and add the next one with the buttons above the canvas: it goes after the step selected, joined to it by an arrow. You can also draw an arrow from the dot on a step's right edge to another step, drag steps around, and delete the selected one with Delete or Backspace (the Flow Start stays).

Each step's settings are beside the canvas when it's selected:

- **Request** sends one of the collection's HTTP requests, as Send does: with its scripts, its assertions, cookies and the active environment. Its response is kept in its history, as a sent response is.
- **Condition** checks the last response, as an [assertion](testing.md) does: its status code, a header, its body, a JSON path or its time. A condition has two ways out: **Yes** when the check holds, **No** when it doesn't. A way with no arrow ends the flow there.
- **Set Variable** gives a variable a value: text (which can use `{{ variables }}` and tags), or a part of the last response, such as the JSON path `$.token`. The requests after it can use it as `{{ token }}`, over the environment's variables, as the runner's data rows are.
- **Delay** waits, up to ten minutes.

Every step but a condition has one way out. An arrow can go back to an earlier step, to poll: a flow that goes round more than 1,000 steps is stopped.

## Running a flow

**Run Flow** runs it from the Flow Start, and **Stop** stops it. Each step is outlined as it runs: green when it passed (or its condition held), amber for a condition that didn't, and red where the flow failed. **Last Run** lists the steps in order, with each request's status, time and size and each condition's check, and then the variables the flow set.

A flow fails at a step that can't run: a request that couldn't be sent, a condition before any response, or a step with nothing chosen. It doesn't fail because a condition didn't hold: that's what its No way is for. To fail a run on a response, give the request [assertions](testing.md), and check them with a condition on its status, or use the collection runner.

## Saving and sharing

A flow is saved as you change it. It belongs to its collection: it's exported and imported with it, and Git Sync commits it with the requests. A flow refers to its requests by their ids, so import and a duplicated collection point the copy's flows at the copies of its requests.

Folder Sync writes a collection's requests, folders and environments to the folder, not its flows.

The canvas is drawn with [React Flow](https://reactflow.dev) (MIT).
