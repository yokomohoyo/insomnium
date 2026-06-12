// Header-injection guard. In the network layer so the send path can validate
// the FINAL header list (after auth strategies contribute); re-exported to MCP.

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/; // RFC 7230 token charset
const HEADER_INJECTION_RE = /[\r\n\0]/;

// Reject CR/LF/NUL (header injection) or out-of-charset names before headers
// reach libcurl/gRPC. Safe on every request - these never appear legitimately.
export function assertSafeHeaders(
  headers: { name?: string; value?: string; disabled?: boolean }[] | undefined,
): void {
  for (const h of headers || []) {
    if (h?.disabled) {
      continue;
    }
    const name = h?.name ?? '';
    const value = h?.value ?? '';
    if (HEADER_INJECTION_RE.test(name) || HEADER_INJECTION_RE.test(value)) {
      throw new Error(`Refusing to send: header '${name}' contains a CR, LF, or NUL character (possible header injection).`);
    }
    if (name && !HEADER_NAME_RE.test(name)) {
      throw new Error(`Refusing to send: '${name}' is not a valid header name.`);
    }
  }
}
