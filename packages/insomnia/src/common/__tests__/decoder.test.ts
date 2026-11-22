/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import { CONVERSIONS, convert, likelyDecodings } from '../decoder';

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'ana', exp: 4102444800 })}.c2lnbmF0dXJl`;

describe('decoding', () => {
  it('reads URL encoding, with a plus for a space', () => {
    expect(convert('url-decode', 'a%20b+c%2Fd%3D%C3%A9')).toBe('a b c/d=é');
    expect(() => convert('url-decode', '100%')).toThrow('a % that is not followed by two hex digits');
  });

  it('reads Base64 in either alphabet, padded or not, and across lines', () => {
    expect(convert('base64-decode', 'aGVsbG8gd29ybGQ=')).toBe('hello world');
    expect(convert('base64-decode', 'aGVsbG8gd29ybGQ')).toBe('hello world');
    expect(convert('base64-decode', 'aGVs\nbG8g d29ybGQ=')).toBe('hello world');
    expect(convert('base64-decode', '_-8')).toBe(convert('base64-decode', '/+8'));
    expect(() => convert('base64-decode', 'not base64!')).toThrow("It isn't Base64");
    expect(() => convert('base64-decode', '')).toThrow("It isn't Base64");
  });

  it('shows bytes that are not text as hex, and says so', () => {
    expect(convert('base64-decode', '/+8A')).toBe('(not text: 3 bytes, as hex) ffef00');
    expect(convert('hex-decode', '00ff')).toBe('(not text: 2 bytes, as hex) 00ff');
  });

  it('reads hex however it is written', () => {
    expect(convert('hex-decode', '68656c6c6f')).toBe('hello');
    expect(convert('hex-decode', '0x68 65:6C-6c,6f')).toBe('hello');
    expect(convert('hex-decode', '\\x68\\x69')).toBe('hi');
    expect(() => convert('hex-decode', '686')).toThrow("It isn't pairs of hex digits");
    expect(() => convert('hex-decode', 'xyz1')).toThrow("It isn't pairs of hex digits");
  });

  it('reads HTML entities, and leaves what is not one', () => {
    expect(convert('html-decode', '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s &#x1F600; &copy; &#99999999;')).toBe('<a href="x">Tom & Jerry\'s 😀 &copy; &#99999999;');
  });

  it('reads the escapes JSON and JavaScript write', () => {
    expect(convert('unicode-decode', 'caf\\u00e9 \\u{1f600} \\x41\\n\\t\\"q\\" \\\\')).toBe('café 😀 A\n\t"q" \\');
  });

  it("lays out a JSON Web Token's header and payload, with its times as dates, and never calls it checked", () => {
    const shown = convert('jwt-decode', `Bearer ${TOKEN}`);

    expect(shown).toContain('Header\n{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
    expect(shown).toContain('Payload\n{\n  "sub": "ana",\n  "exp": 4102444800\n}');
    expect(shown).toContain('exp: 2100-01-01T00:00:00.000Z');
    expect(shown).toContain('Signature (not checked)\nc2lnbmF0dXJl');
    expect(convert('jwt-decode', TOKEN.split('.').slice(0, 2).join('.') + '.')).toContain('No signature');
    expect(() => convert('jwt-decode', 'abc')).toThrow("It isn't a JSON Web Token");
    expect(() => convert('jwt-decode', 'abc.def.ghi')).toThrow("Its payload isn't Base64 of JSON");
  });
});

describe('encoding', () => {
  it('writes each encoding so that decoding gives the value back', () => {
    const value = 'a b/c=é&<"\'>😀\n';

    for (const [encode, decode] of [['url-encode', 'url-decode'], ['url-encode-all', 'url-decode'], ['base64-encode', 'base64-decode'], ['base64url-encode', 'base64-decode'], ['hex-encode', 'hex-decode'], ['html-encode', 'html-decode'], ['unicode-encode', 'unicode-decode']]) {
      expect([encode, convert(decode, convert(encode, value))]).toEqual([encode, value]);
    }
  });

  it('writes them as they are usually seen', () => {
    expect(convert('url-encode', 'a b&c')).toBe('a%20b%26c');
    expect(convert('url-encode-all', 'a.é')).toBe('%61%2E%C3%A9');
    expect(convert('base64-encode', 'hi?>')).toBe('aGk/Pg==');
    expect(convert('base64url-encode', 'hi?>')).toBe('aGk_Pg');
    expect(convert('hex-encode', 'hi')).toBe('6869');
    expect(convert('html-encode', '<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
    expect(convert('unicode-encode', 'é"\n')).toBe('\\u00e9\\"\\n');
  });
});

describe('hashing', () => {
  it('gives the usual hashes of the text, as hex', () => {
    expect(convert('md5', 'hello')).toBe('5d41402abc4b2a76b9719d911017c592');
    expect(convert('sha1', 'hello')).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
    expect(convert('sha256', 'hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(convert('sha512', '')).toHaveLength(128);
  });
});

describe('the conversions', () => {
  it('each have an id of their own, and an unknown one is refused', () => {
    expect(new Set(CONVERSIONS.map(({ id }) => id)).size).toBe(CONVERSIONS.length);
    expect(() => convert('rot13', 'x')).toThrow('No conversion named rot13');
  });
});

describe('likelyDecodings()', () => {
  it("guesses from a value's shape", () => {
    expect(likelyDecodings(TOKEN)).toEqual(['jwt-decode']);
    expect(likelyDecodings(`Bearer ${TOKEN}`)).toEqual(['jwt-decode']);
    expect(likelyDecodings('a%20b%2Fc')).toEqual(['url-decode']);
    expect(likelyDecodings('Tom &amp; Jerry')).toEqual(['html-decode']);
    expect(likelyDecodings('caf\\u00e9')).toEqual(['unicode-decode']);
    expect(likelyDecodings('68656c6c6f20776f726c64')).toEqual(['hex-decode']);
    expect(likelyDecodings('aGVsbG8gd29ybGQ=')).toEqual(['base64-decode']);
  });

  it("doesn't take a word, a number or nothing for an encoding", () => {
    expect(likelyDecodings('')).toEqual([]);
    expect(likelyDecodings('hello')).toEqual([]);
    expect(likelyDecodings('password')).toEqual([]);
    expect(likelyDecodings('12345')).toEqual([]);
    expect(likelyDecodings('just some words')).toEqual([]);
  });
});
