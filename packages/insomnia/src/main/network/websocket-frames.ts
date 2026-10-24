// Binary WebSocket frames: a message written as hex or base64 is sent as the
// bytes it spells, and a binary frame received is kept in the event log as
// base64 (JSON can't hold bytes), flagged so the event view can show it as a
// hex dump. Also the reconnect setting's limits.

// payload modes (WebSocketPayload.mode) whose text is sent as a binary frame
export const PAYLOAD_HEX = 'binary/hex';
export const PAYLOAD_BASE64 = 'binary/base64';
export type BinaryEncoding = 'hex' | 'base64';

export const binaryEncodingOf = (mode?: string): BinaryEncoding | undefined =>
  mode === PAYLOAD_HEX ? 'hex' : mode === PAYLOAD_BASE64 ? 'base64' : undefined;

// The bytes a message spells. Hex may be spaced, split by : or -, and have 0x
// before each byte, as copied from a dump; base64 may be URL-safe and wrapped.
export function payloadBytes(text: string, encoding: BinaryEncoding): Buffer {
  if (encoding === 'hex') {
    const digits = text.replace(/0x/gi, '').replace(/[\s:,-]/g, '');
    if (!/^[0-9a-f]*$/i.test(digits)) {
      throw new Error('The message isn\'t hex: use the digits 0-9 and a-f, two to a byte');
    }
    if (digits.length % 2) {
      throw new Error('The hex message has an odd number of digits: each byte is two');
    }
    return Buffer.from(digits, 'hex');
  }
  const characters = text.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(characters) || characters.length % 4 === 1) {
    throw new Error('The message isn\'t base64');
  }
  return Buffer.from(characters.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// what ws hands a message listener for a binary frame, as bytes
export const bytesOf = (data: unknown): Buffer | undefined => {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (Array.isArray(data) && data.every(part => Buffer.isBuffer(part))) {
    return Buffer.concat(data);
  }
  return undefined;
};

// A frame as the event log keeps it: text as is, bytes as base64 and flagged.
// An event log from before this kept bytes as Buffer's JSON, {type, data}.
export const loggedData = (data: unknown): { data: string; binary?: true } => {
  const bytes = bytesOf(data);
  return bytes ? { data: bytes.toString('base64'), binary: true } : { data: String(data) };
};

export const loggedBytes = (event: { data: unknown; binary?: boolean }): Buffer | undefined => {
  if (event.binary && typeof event.data === 'string') {
    return Buffer.from(event.data, 'base64');
  }
  const data = event.data as { type?: string; data?: unknown } | null;
  if (data && typeof data === 'object' && data.type === 'Buffer' && Array.isArray(data.data)) {
    return Buffer.from(data.data as number[]);
  }
  return undefined;
};

// 00000000  48 65 6c 6c 6f 20 77 6f  72 6c 64 0a              |Hello world.|
export function hexDump(bytes: Buffer, limit = 64 * 1024): string {
  const lines: string[] = [];
  const shown = bytes.subarray(0, limit);
  for (let offset = 0; offset < shown.length; offset += 16) {
    const row = shown.subarray(offset, offset + 16);
    const hex = [...row].map(byte => byte.toString(16).padStart(2, '0'));
    const left = hex.slice(0, 8).join(' ');
    const right = hex.slice(8).join(' ');
    const text = [...row].map(byte => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${left.padEnd(23)}  ${right.padEnd(23)}  |${text}|`);
  }
  if (bytes.length > limit) {
    lines.push(`… ${bytes.length - limit} more bytes`);
  }
  return lines.join('\n') || '(empty)';
}

// the reconnect setting, within bounds: 1 s to 5 min apart, 1 to 100 tries
export interface ReconnectSetting {
  enabled: boolean;
  delaySeconds: number;
  maxAttempts: number;
}
export const DEFAULT_RECONNECT: ReconnectSetting = { enabled: false, delaySeconds: 3, maxAttempts: 10 };
export const reconnectLimits = (setting?: Partial<ReconnectSetting>) => {
  const { enabled, delaySeconds, maxAttempts } = { ...DEFAULT_RECONNECT, ...setting };
  const clamp = (value: number, low: number, high: number, fallback: number) => (Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback);
  return {
    enabled: enabled === true,
    delayMs: Math.round(clamp(Number(delaySeconds), 1, 300, DEFAULT_RECONNECT.delaySeconds) * 1000),
    maxAttempts: Math.round(clamp(Number(maxAttempts), 1, 100, DEFAULT_RECONNECT.maxAttempts)),
  };
};
