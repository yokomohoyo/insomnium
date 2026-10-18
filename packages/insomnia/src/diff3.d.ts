declare module 'diff3' {
  interface Diff3Block<T> {
    ok?: T[];
    conflict?: { a: T[]; aIndex: number; o: T[]; oIndex: number; b: T[]; bIndex: number };
  }
  // ours, the base, theirs
  export default function diff3Merge<T>(a: T[], o: T[], b: T[]): Diff3Block<T>[];
}
