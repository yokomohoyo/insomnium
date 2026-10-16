// nunjucks is not a sandbox: a template's lookups can reach any property of
// any value, constructors and prototypes included. Refuse those names in both
// lookup paths compiled templates go through, so a template can only read data.
const BLOCKED_KEYS = new Set([
  'constructor',
  'prototype',
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

export interface NunjucksRuntime {
  memberLookup: (obj: unknown, key: unknown) => unknown;
  contextOrFrameLookup: (context: unknown, frame: unknown, name: string) => unknown;
}

const hardened = new WeakSet<NunjucksRuntime>();

export function hardenNunjucksRuntime(runtime: NunjucksRuntime) {
  if (hardened.has(runtime)) {
    return;
  }
  const { memberLookup, contextOrFrameLookup } = runtime;
  runtime.memberLookup = (obj, key) => (BLOCKED_KEYS.has(String(key)) ? undefined : memberLookup(obj, key));
  runtime.contextOrFrameLookup = (context, frame, name) =>
    (BLOCKED_KEYS.has(name) ? undefined : contextOrFrameLookup(context, frame, name));
  hardened.add(runtime);
}
