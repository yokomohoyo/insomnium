// The parts of ssh2 (https://github.com/mscdex/ssh2) the app uses: as a client
// for Git over SSH (main/git-ssh), and as a server in its tests. @types/ssh2
// brings its own @types/node, which clashes with the app's.
declare module 'ssh2' {
  import { EventEmitter } from 'events';
  import { Duplex, Readable } from 'stream';

  export interface ParsedKey {
    type: string;
    comment: string;
    getPublicSSH(): Buffer;
    verify(data: Buffer, signature: Buffer): boolean | Error;
    sign(data: Buffer, algo?: string): Buffer | Error;
  }

  // an SSH agent's keys, and their signatures
  export class BaseAgent {
    getIdentities(callback: (err: Error | null | undefined, keys?: ParsedKey[]) => void): void;
    sign(pubKey: ParsedKey, data: Buffer, options: { hash?: string } | undefined, callback: (err: Error | null | undefined, signature?: Buffer) => void): void;
  }

  // the agent at a socket, a Windows pipe, or 'pageant'
  export function createAgent(socketPath: string): BaseAgent;

  export interface ClientChannel extends Duplex {
    stderr: Readable;
    exit(code: number): void;
    close(): void;
    on(event: 'close', listener: (code: number | null, signal?: string) => void): this;
    on(event: 'exit', listener: (code: number | null, signal?: string) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export type AuthMethod =
    | { type: 'none'; username: string }
    | { type: 'agent'; username: string; agent: string | BaseAgent }
    | { type: 'publickey'; username: string; key: ParsedKey | Buffer | string; passphrase?: string };

  export interface ConnectConfig {
    host: string;
    port?: number;
    username: string;
    readyTimeout?: number;
    keepaliveInterval?: number;
    hostVerifier?: (key: Buffer, verify: (valid: boolean) => void) => void;
    authHandler?: AuthMethod[];
    debug?: (message: string) => void;
  }

  export class Client extends EventEmitter {
    connect(config: ConnectConfig): this;
    exec(command: string, callback: (err: Error | undefined, channel: ClientChannel) => void): this;
    end(): this;
    on(event: 'ready' | 'close', listener: () => void): this;
    on(event: 'error', listener: (err: Error & { level?: string }) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export namespace utils {
    function parseKey(data: Buffer | string, passphrase?: string): ParsedKey | ParsedKey[] | Error;
    function generateKeyPairSync(type: 'ed25519' | 'rsa' | 'ecdsa', options?: { bits?: number; comment?: string; passphrase?: string; cipher?: string; rounds?: number }): { private: string; public: string };
  }

  // the server side, for tests
  export interface AuthContext {
    method: string;
    username: string;
    key?: { algo: string; data: Buffer };
    signature?: Buffer;
    blob?: Buffer;
    accept(): void;
    reject(methods?: string[]): void;
  }

  export interface ServerChannel extends Duplex {
    stderr: Duplex;
    exit(code: number): void;
  }

  export interface Session extends EventEmitter {
    on(event: 'exec', listener: (accept: () => ServerChannel, reject: () => void, info: { command: string }) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export interface Connection extends EventEmitter {
    end(): this;
    on(event: 'authentication', listener: (context: AuthContext) => void): this;
    on(event: 'ready' | 'close' | 'end', listener: () => void): this;
    on(event: 'session', listener: (accept: () => Session, reject: () => void) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export class Server extends EventEmitter {
    constructor(config: { hostKeys: (Buffer | string)[] }, connectionListener?: (client: Connection) => void);
    listen(port: number, host: string, callback?: () => void): this;
    address(): { port: number };
    close(callback?: () => void): this;
  }
}
