# Comparing responses and decoding values

Two small tools for looking at what an API sends back. Neither sends anything.

## Compare responses

**Compare Responses**, in the response history menu (the time at the top right of the response pane), shows two of a request's responses against each other: what the second has that the first hasn't. It's for telling what a change did to the answer: another user, another parameter, the same request after a deploy.

It opens on the response you're looking at and the one before it; choose any two from the request's history.

| Part | |
| --- | --- |
| Status | the status code and its text |
| Headers | each header as a line, in name order, so the order a server sends them in doesn't count as a difference |
| Body | line by line. JSON is laid out the same way for both first, so only a difference in the data shows |

Lines only the first has are marked `-`, lines only the second has `+`, each with its line number in its own response. **Only what differs** shows the changes with a few lines either side; untick it for every line.

Only the first megabyte of each body is compared, and bodies of many thousands of differing lines are shown one after the other instead of lined up.

Responses are kept as the request's history is: up to the number set in Preferences, and only those sent normally. What the [security checks](security-checks.md) and the [fuzzer](fuzzing.md) send isn't kept, so it isn't there to compare.

## Decoder

**Decoder**, the `</>` button at the bottom of the app's left edge, converts a value between the encodings it goes through on its way to and from an API. It's worked out in the app: the value goes nowhere.

| | |
| --- | --- |
| Decode | URL, Base64 (either alphabet, padded or not), hex, HTML entities, `\u` and `\x` escapes, and a JSON Web Token's header and payload |
| Encode | URL (what needs it, or every character), Base64 and its URL-safe form, hex, HTML entities, escapes |
| Hash | MD5, SHA-1, SHA-256, SHA-512, of the value as UTF-8 text |

The decodings the value looks like are highlighted, as a guess from its shape. **Use as the Value** puts the result back in, for a value encoded more than once: Base64 of URL encoding, say.

A JSON Web Token is laid out with its `iat`, `nbf` and `exp` times as dates. Its signature is shown and **not checked**: decoding a token says what it claims, not that the claims are true. Bytes that aren't text are shown as hex, and said to be.
