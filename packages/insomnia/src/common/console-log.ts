// The console's record of this session's sends, across requests and the
// runner (network.ts's responseTransform adds each), with what the scripts
// logged and how the assertions went. In memory only, and bounded.
export const MAX_CONSOLE_ENTRIES = 500;

export interface ConsoleEntry {
  id: number;
  at: number;
  requestId: string;
  name: string;
  method: string;
  url: string;
  statusCode?: number;
  statusMessage?: string;
  elapsedTime?: number;
  bytesRead?: number;
  error?: string;
  logs: { level: string; message: string }[];
  passed: number;
  failed: number;
}

let entries: ConsoleEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

export function recordSend(entry: Omit<ConsoleEntry, 'id' | 'at'>, at = Date.now()) {
  entries = [...entries, { ...entry, id: nextId++, at }].slice(-MAX_CONSOLE_ENTRIES);
  notify();
}

export function clearConsole() {
  entries = [];
  notify();
}

export const consoleEntries = () => entries;

export const subscribeToConsole = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// an entry for a response, as responseTransform finished it
export function entryFor(
  request: { _id: string; name?: string; method?: string; url?: string },
  response: { statusCode?: number; statusMessage?: string; elapsedTime?: number; bytesRead?: number; error?: string; scriptLogs?: { level: string; message: string }[]; assertionResults?: { passed: boolean }[] },
): Omit<ConsoleEntry, 'id' | 'at'> {
  const results = response.assertionResults || [];
  return {
    requestId: request._id,
    name: request.name || '',
    method: request.method || 'GET',
    url: request.url || '',
    statusCode: response.statusCode || undefined,
    statusMessage: response.statusMessage || undefined,
    elapsedTime: response.elapsedTime,
    bytesRead: response.bytesRead,
    ...(response.error ? { error: response.error } : {}),
    logs: response.scriptLogs || [],
    passed: results.filter(result => result.passed).length,
    failed: results.filter(result => !result.passed).length,
  };
}
