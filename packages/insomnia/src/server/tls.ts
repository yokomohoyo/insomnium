// HTTPS without a reverse proxy, for a small network with its own certificate:
// INSOMNIUM_TLS_CERT and INSOMNIUM_TLS_KEY name PEM files. The servers speak
// plain HTTP without them, for a proxy or ingress to put HTTPS in front.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

export interface TlsFiles {
  cert: string;
  key: string;
}

export const TLS_USAGE = `  INSOMNIUM_TLS_CERT       a PEM certificate (with its chain) to serve HTTPS with, read again
                           when it changes; set INSOMNIUM_TLS_KEY too. Without them, plain HTTP
  INSOMNIUM_TLS_KEY        the certificate's PEM private key`;

// both files or neither; set but empty is unset
export function parseTls(env: Record<string, string | undefined>): TlsFiles | undefined {
  const cert = env.INSOMNIUM_TLS_CERT?.trim();
  const key = env.INSOMNIUM_TLS_KEY?.trim();
  if (!cert && !key) {
    return undefined;
  }
  if (!cert || !key) {
    throw new Error('Set both INSOMNIUM_TLS_CERT and INSOMNIUM_TLS_KEY to serve HTTPS, or neither for plain HTTP');
  }
  return { cert, key };
}

const read = (tls: TlsFiles) => {
  try {
    return { cert: fs.readFileSync(tls.cert), key: fs.readFileSync(tls.key) };
  } catch (err) {
    throw new Error(`Couldn't read the TLS certificate or key: ${(err as Error).message}`);
  }
};

// how often a changed certificate is noticed
const WATCH_MS = 60_000;

// an HTTP server, or an HTTPS one that picks up a renewed certificate
export function createListener(handler: http.RequestListener, tls?: TlsFiles): http.Server {
  if (!tls) {
    return http.createServer(handler);
  }
  const server = https.createServer(read(tls), handler);
  const reload = () => {
    try {
      server.setSecureContext(read(tls));
      console.log('[server] loaded the renewed TLS certificate');
    } catch (err) {
      // keep serving the one it has
      console.error('[server]', (err as Error).message);
    }
  };
  fs.watchFile(tls.cert, { interval: WATCH_MS }, reload);
  fs.watchFile(tls.key, { interval: WATCH_MS }, reload);
  server.on('close', () => {
    fs.unwatchFile(tls.cert, reload);
    fs.unwatchFile(tls.key, reload);
  });
  return server;
}
