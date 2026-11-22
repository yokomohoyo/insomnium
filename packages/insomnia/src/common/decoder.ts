// The Decoder's conversions: the encodings a value goes through between an
// API and what's readable (URL, Base64, hex, HTML, a JSON Web Token), and the
// common hashes. Each takes text and gives text, or throws with why it can't.
import crypto from 'node:crypto';

export interface Conversion {
  id: string;
  name: string;
  group: 'decode' | 'encode' | 'hash';
  run: (text: string) => string;
}

// bytes that aren't text are shown as hex, said to be so
const readable = (bytes: Buffer) => {
  const text = bytes.toString('utf8');
  return Buffer.from(text, 'utf8').equals(bytes) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
    ? text
    : `(not text: ${bytes.length} bytes, as hex) ${bytes.toString('hex')}`;
};

const fromBase64 = (text: string) => {
  const compact = text.replace(/\s+/g, '');
  // the URL-safe alphabet too, and padding or none
  if (!compact || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(compact) || compact.replace(/=+$/, '').length % 4 === 1) {
    throw new Error("It isn't Base64");
  }
  return Buffer.from(compact.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
};

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const pretty = (part: string, what: string) => {
  try {
    return JSON.stringify(JSON.parse(fromBase64(part).toString('utf8')), null, 2);
  } catch {
    throw new Error(`Its ${what} isn't Base64 of JSON`);
  }
};

const hash = (algorithm: string) => (text: string) => crypto.createHash(algorithm).update(text, 'utf8').digest('hex');

export const CONVERSIONS: Conversion[] = [
  {
    id: 'url-decode',
    name: 'URL',
    group: 'decode',
    run: text => {
      try {
        return decodeURIComponent(text.replace(/\+/g, ' '));
      } catch {
        throw new Error('It has a % that is not followed by two hex digits, or bytes that are not text');
      }
    },
  },
  { id: 'base64-decode', name: 'Base64', group: 'decode', run: text => readable(fromBase64(text)) },
  {
    id: 'hex-decode',
    name: 'Hex',
    group: 'decode',
    run: text => {
      const compact = text.replace(/^0x/i, '').replace(/[\s:,-]|\\x|0x/gi, '');
      if (!compact || compact.length % 2 || !/^[0-9a-f]+$/i.test(compact)) {
        throw new Error("It isn't pairs of hex digits");
      }
      return readable(Buffer.from(compact, 'hex'));
    },
  },
  {
    id: 'html-decode',
    name: 'HTML',
    group: 'decode',
    run: text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
      if (entity[0] !== '#') {
        return HTML_ENTITIES[entity.toLowerCase()] ?? whole;
      }
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }),
  },
  {
    id: 'unicode-decode',
    name: 'Escapes',
    group: 'decode',
    // é, \u{1f600}, \x41 and the one-letter ones, as JSON and JavaScript write them
    run: text => text.replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})|\\([nrt\\"'/])/gi, (whole, braced, four, two, letter) => {
      if (letter) {
        return ({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[letter.toLowerCase()] ?? letter;
      }
      const code = parseInt(braced || four || two, 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }),
  },
  {
    id: 'jwt-decode',
    name: 'JSON Web Token',
    group: 'decode',
    run: text => {
      const parts = text.trim().replace(/^Bearer\s+/i, '').split('.');
      if (parts.length !== 3 && parts.length !== 2) {
        throw new Error("It isn't a JSON Web Token: that is two or three parts with dots between");
      }
      const payload = pretty(parts[1], 'payload');
      // the times in it, as dates: what's usually being looked for
      const claims = JSON.parse(payload) as Record<string, unknown>;
      const times = ['iat', 'nbf', 'exp'].filter(name => typeof claims?.[name] === 'number')
        .map(name => `${name}: ${new Date((claims[name] as number) * 1000).toISOString()}`);
      return [
        `Header\n${pretty(parts[0], 'header')}`,
        `Payload\n${payload}`,
        ...(times.length ? [times.join('\n')] : []),
        parts[2] ? `Signature (not checked)\n${parts[2]}` : 'No signature',
      ].join('\n\n');
    },
  },
  { id: 'url-encode', name: 'URL', group: 'encode', run: text => encodeURIComponent(text) },
  { id: 'url-encode-all', name: 'URL, every character', group: 'encode', run: text => [...Buffer.from(text, 'utf8')].map(byte => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('') },
  { id: 'base64-encode', name: 'Base64', group: 'encode', run: text => Buffer.from(text, 'utf8').toString('base64') },
  { id: 'base64url-encode', name: 'Base64, URL-safe', group: 'encode', run: text => Buffer.from(text, 'utf8').toString('base64url') },
  { id: 'hex-encode', name: 'Hex', group: 'encode', run: text => Buffer.from(text, 'utf8').toString('hex') },
  { id: 'html-encode', name: 'HTML', group: 'encode', run: text => text.replace(/[&<>"']/g, character => `&${({ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' } as Record<string, string>)[character]};`) },
  { id: 'unicode-encode', name: 'Escapes', group: 'encode', run: text => JSON.stringify(text).slice(1, -1).replace(/[\u0080-￿]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`) },
  { id: 'md5', name: 'MD5', group: 'hash', run: hash('md5') },
  { id: 'sha1', name: 'SHA-1', group: 'hash', run: hash('sha1') },
  { id: 'sha256', name: 'SHA-256', group: 'hash', run: hash('sha256') },
  { id: 'sha512', name: 'SHA-512', group: 'hash', run: hash('sha512') },
];

export const convert = (id: string, text: string) => {
  const conversion = CONVERSIONS.find(candidate => candidate.id === id);
  if (!conversion) {
    throw new Error(`No conversion named ${id}`);
  }
  return conversion.run(text);
};

// What a value looks like it's encoded as: the decodings worth trying first.
// A guess from its shape, so several can apply and none is certain
export const likelyDecodings = (text: string): string[] => {
  const value = text.trim();
  if (!value) {
    return [];
  }
  const found: string[] = [];
  if (/^(Bearer\s+)?eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(value)) {
    found.push('jwt-decode');
  }
  if (/%[0-9a-f]{2}/i.test(value)) {
    found.push('url-decode');
  }
  if (/&(#x?[0-9a-f]+|[a-z]+);/i.test(value)) {
    found.push('html-decode');
  }
  if (/\\u[0-9a-f]{4}|\\u\{[0-9a-f]+\}|\\x[0-9a-f]{2}/i.test(value)) {
    found.push('unicode-decode');
  }
  if (value.length >= 8 && value.length % 2 === 0 && /^(0x)?[0-9a-f]+$/i.test(value)) {
    found.push('hex-decode');
  }
  // long enough not to be a word, and it decodes to text
  if (!found.includes('jwt-decode') && value.length >= 8 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(value) && /[A-Z]/.test(value) && /[a-z0-9]/.test(value)) {
    try {
      if (!readable(fromBase64(value)).startsWith('(not text')) {
        found.push('base64-decode');
      }
    } catch {
      // not Base64 after all
    }
  }
  return found;
};
