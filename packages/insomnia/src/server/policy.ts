import { canonicalHost, isMetadataHost } from '../network/metadata-hosts';

/**
 * The headless server's request policy. Only http and https, only to the
 * allowed hosts: exact names or addresses, `*.example.com` for subdomains, or
 * `*` for any. Metadata hosts need listing by name even with `*`; unless one
 * is, no connection goes to a metadata address, whatever name leads there
 * (server.ts sets that guard).
 */
export const makeHostPolicy = (allowedHosts: string[]) => (url: string) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Refusing to send to '${url}': not a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refusing to send to '${url}': only http and https are allowed`);
  }
  const host = canonicalHost(parsed.hostname);
  const listed = allowedHosts.some(pattern => pattern === host || (pattern.startsWith('*.') && host.endsWith(pattern.slice(1))));
  if (isMetadataHost(host) && !listed) {
    throw new Error(`Refusing to send to ${host}: cloud metadata hosts are blocked unless INSOMNIUM_ALLOWED_HOSTS lists them`);
  }
  if (!listed && !allowedHosts.includes('*')) {
    throw new Error(`Refusing to send to ${host}: it is not in INSOMNIUM_ALLOWED_HOSTS`);
  }
};
