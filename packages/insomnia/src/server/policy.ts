import net from 'node:net';

// Cloud metadata endpoints answer on link-local addresses or these names; a
// request there could hand an agent the machine's cloud credentials.
const METADATA_NAMES = new Set(['metadata', 'metadata.google.internal']);

// the IPv4 address in an IPv4-mapped IPv6 one, as URL writes it (::ffff:a9fe:a9fe)
const unmapIPv4 = (host: string) => {
  const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) {
    return host;
  }
  const [high, low] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
};

const isMetadataHost = (host: string) => {
  if (METADATA_NAMES.has(host)) {
    return true;
  }
  if (net.isIPv4(host)) {
    return host.startsWith('169.254.');
  }
  // fe80::/10 link-local, and AWS's IPv6 instance metadata address
  return net.isIPv6(host) && (/^fe[89ab][0-9a-f]:/.test(host) || host === 'fd00:ec2::254');
};

/**
 * The headless server's request policy. Only http and https, only to the
 * allowed hosts: exact names or addresses, `*.example.com` for subdomains, or
 * `*` for any. Metadata hosts need listing by name even with `*`.
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
  const host = unmapIPv4(parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1'));
  const listed = allowedHosts.some(pattern => pattern === host || (pattern.startsWith('*.') && host.endsWith(pattern.slice(1))));
  if (isMetadataHost(host) && !listed) {
    throw new Error(`Refusing to send to ${host}: cloud metadata hosts are blocked unless INSOMNIUM_ALLOWED_HOSTS lists them`);
  }
  if (!listed && !allowedHosts.includes('*')) {
    throw new Error(`Refusing to send to ${host}: it is not in INSOMNIUM_ALLOWED_HOSTS`);
  }
};
