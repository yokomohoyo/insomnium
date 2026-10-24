/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import { binaryEncodingOf, bytesOf, hexDump, loggedBytes, loggedData, PAYLOAD_BASE64, PAYLOAD_HEX, payloadBytes, reconnectLimits } from '../websocket-frames';

describe('payloadBytes', () => {
  it('reads hex as copied from a dump: spaced, split, with 0x', () => {
    for (const text of ['48656c6c6f', '48 65 6c 6c 6f', '0x48 0x65 0x6C 0x6c 0x6f', '48:65:6c:6c:6f', '48-65-6c\n6c-6f']) {
      expect(payloadBytes(text, 'hex').toString()).toBe('Hello');
    }
    expect(payloadBytes('', 'hex')).toEqual(Buffer.alloc(0));
  });

  it("refuses hex that isn't", () => {
    expect(() => payloadBytes('4g', 'hex')).toThrow("isn't hex");
    expect(() => payloadBytes('486', 'hex')).toThrow('odd number of digits');
  });

  it('reads base64, URL-safe and wrapped too', () => {
    expect(payloadBytes('SGVsbG8=', 'base64').toString()).toBe('Hello');
    expect(payloadBytes('SGVs\nbG8', 'base64').toString()).toBe('Hello');
    expect([...payloadBytes('-_8', 'base64')]).toEqual([0xfb, 0xff]);
    expect(() => payloadBytes('SGV$bG8=', 'base64')).toThrow("isn't base64");
    expect(() => payloadBytes('SGVsb', 'base64')).toThrow("isn't base64");
  });

  it('knows the binary modes', () => {
    expect(binaryEncodingOf(PAYLOAD_HEX)).toBe('hex');
    expect(binaryEncodingOf(PAYLOAD_BASE64)).toBe('base64');
    expect(binaryEncodingOf('application/json')).toBeUndefined();
  });
});

describe('the event log', () => {
  it('keeps text as is and bytes as base64, flagged', () => {
    expect(loggedData('hi')).toEqual({ data: 'hi' });
    expect(loggedData(Buffer.from('hi'))).toEqual({ data: 'aGk=', binary: true });
    expect(loggedData([Buffer.from('h'), Buffer.from('i')])).toEqual({ data: 'aGk=', binary: true });
    expect(loggedData(new Uint8Array([104, 105]).buffer)).toEqual({ data: 'aGk=', binary: true });
    expect(bytesOf('hi')).toBeUndefined();
  });

  it('reads bytes back, from this log or an older one', () => {
    expect(loggedBytes({ data: 'aGk=', binary: true })?.toString()).toBe('hi');
    expect(loggedBytes(JSON.parse(JSON.stringify({ data: Buffer.from('hi') })))?.toString()).toBe('hi');
    expect(loggedBytes({ data: 'aGk=' })).toBeUndefined();
  });

  it('shows bytes as a hex dump', () => {
    // offset, two columns of 8 bytes padded to line up, then the text
    expect(hexDump(Buffer.from('Hello world\n'))).toBe(`00000000  48 65 6c 6c 6f 20 77 6f  72 6c 64 0a${' '.repeat(14)}|Hello world.|`);
    expect(hexDump(Buffer.alloc(18)).split('\n')[1]).toBe(`00000010  00 00${' '.repeat(45)}|..|`);
    expect(hexDump(Buffer.alloc(0))).toBe('(empty)');
    expect(hexDump(Buffer.alloc(40), 32).split('\n').pop()).toBe('… 8 more bytes');
  });
});

describe('reconnectLimits', () => {
  it('is off unless asked, and keeps its numbers in bounds', () => {
    expect(reconnectLimits()).toEqual({ enabled: false, delayMs: 3000, maxAttempts: 10 });
    expect(reconnectLimits({ enabled: true, delaySeconds: 0.2, maxAttempts: 1000 })).toEqual({ enabled: true, delayMs: 1000, maxAttempts: 100 });
    expect(reconnectLimits({ enabled: true, delaySeconds: NaN, maxAttempts: -1 })).toEqual({ enabled: true, delayMs: 3000, maxAttempts: 1 });
  });
});
