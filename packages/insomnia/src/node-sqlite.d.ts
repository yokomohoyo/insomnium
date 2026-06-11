// Minimal node:sqlite typings (@types/node 20 lacks them); only what sqlite-store.ts uses.
declare module 'node:sqlite' {
  export interface StatementSync {
    all(...params: (string | number | bigint | null)[]): unknown[];
    get(...params: (string | number | bigint | null)[]): unknown;
    run(...params: (string | number | bigint | null)[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
