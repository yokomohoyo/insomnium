// The page of a plugin's sandbox (main/plugin-sandbox.ts writes it, with this
// inline): it loads the plugin once the app's port comes, and runs it.
import { type Port, startRuntime } from './runtime';

declare global {
  interface Window {
    pluginHost: { read(file: string): string | null };
  }
}

// The session sends nothing anywhere already; these go too, before the
// plugin's code runs, so it doesn't look as if they'd work
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'Worker', 'SharedWorker', 'open']) {
  try {
    Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false });
  } catch {
    // one the page can't change
  }
}

window.addEventListener('message', event => {
  const [port] = event.ports;
  if (event.source !== window || event.data?.type !== 'plugin-host:start' || !port) {
    return;
  }
  startRuntime(port as unknown as Port, { read: file => window.pluginHost.read(file) }, String(event.data.data.directory));
  port.start();
});
