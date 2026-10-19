// Node's Buffer, as far as plugins mostly use it (from, toString, concat,
// alloc, byteLength), for a sandbox, which has no Node.js: bytes, and the
// utf8, base64, base64url, hex and latin1 encodings.
type Encoding = 'utf8' | 'utf-8' | 'base64' | 'base64url' | 'hex' | 'latin1' | 'binary' | 'ascii';

const binary = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return text;
};

const fromBinary = (text: string) => Uint8Array.from(text, char => char.charCodeAt(0) & 0xff);

function encode(text: string, encoding: Encoding = 'utf8'): Uint8Array {
  switch (encoding) {
    case 'base64':
    case 'base64url': {
      const plain = text.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
      return fromBinary(atob(plain + '='.repeat((4 - (plain.length % 4)) % 4)));
    }
    case 'hex':
      return Uint8Array.from(text.match(/[0-9a-fA-F]{2}/g) || [], pair => parseInt(pair, 16));
    case 'latin1':
    case 'binary':
    case 'ascii':
      return fromBinary(text);
    default:
      return new TextEncoder().encode(text);
  }
}

// @ts-expect-error -- Node's from takes an encoding, where a typed array's takes a map function
export class SandboxBuffer extends Uint8Array {
  static from(value: string | ArrayLike<number> | ArrayBuffer | Uint8Array, encoding?: Encoding | number): SandboxBuffer {
    if (typeof value === 'string') {
      const bytes = encode(value, typeof encoding === 'string' ? encoding : 'utf8');
      return new SandboxBuffer(bytes.buffer, bytes.byteOffset, bytes.length);
    }
    if (value instanceof ArrayBuffer) {
      return new SandboxBuffer(value.slice(0));
    }
    const out = new SandboxBuffer(value.length);
    out.set(value as ArrayLike<number>);
    return out;
  }

  static alloc(size: number, fill = 0) {
    return new SandboxBuffer(size).fill(fill) as SandboxBuffer;
  }

  static isBuffer(value: unknown): value is SandboxBuffer {
    return value instanceof SandboxBuffer;
  }

  static byteLength(value: string | Uint8Array, encoding?: Encoding) {
    return typeof value === 'string' ? encode(value, encoding).length : value.length;
  }

  static concat(list: Uint8Array[], length?: number) {
    const total = length ?? list.reduce((size, item) => size + item.length, 0);
    const out = new SandboxBuffer(total);
    let offset = 0;
    for (const item of list) {
      out.set(item.subarray(0, Math.max(0, total - offset)), offset);
      offset += item.length;
      if (offset >= total) {
        break;
      }
    }
    return out;
  }

  // as Node's: an encoding, where a typed array's takes none
  toString(encoding: Encoding = 'utf8', start = 0, end = this.length): string {
    const bytes = this.subarray(start, end);
    switch (encoding) {
      case 'base64':
        return btoa(binary(bytes));
      case 'base64url':
        return btoa(binary(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      case 'hex':
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      case 'latin1':
      case 'binary':
      case 'ascii':
        return binary(bytes);
      default:
        return new TextDecoder().decode(bytes);
    }
  }

  equals(other: Uint8Array) {
    return this.length === other.length && this.every((byte, index) => byte === other[index]);
  }

  toJSON() {
    return { type: 'Buffer', data: Array.from(this) };
  }
}
