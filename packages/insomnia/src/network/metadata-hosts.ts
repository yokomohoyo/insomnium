import dns from 'node:dns';
import net from 'node:net';

// Cloud metadata endpoints answer on link-local addresses (AWS, GCP and Azure
// on 169.254.169.254, ECS on 169.254.170.2) or these names; a request there
// can hand the machine's cloud credentials to whoever asked for it.
const METADATA_NAMES = new Set(['metadata', 'metadata.google.internal']);

// lower-cased, unbracketed, without a trailing dot, and an IPv4-mapped IPv6
// address (::ffff:a9fe:a9fe, as URL writes it, or ::ffff:169.254.169.254) as its IPv4
export const canonicalHost = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  const mapped = host.match(/^(?:0{0,4}:){0,5}:?ffff:(.+)$/);
  if (!mapped || !net.isIPv6(host)) {
    return host;
  }
  if (net.isIPv4(mapped[1])) {
    return mapped[1];
  }
  const hex = mapped[1].match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) {
    return host;
  }
  const [high, low] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
};

export const isMetadataAddress = (address: string) => {
  const host = canonicalHost(address);
  if (net.isIPv4(host)) {
    return host.startsWith('169.254.');
  }
  // fe80::/10 link-local, and AWS's IPv6 instance metadata address
  return net.isIPv6(host) && (/^fe[89ab][0-9a-f]:/.test(host) || host === 'fd00:ec2::254');
};

export const isMetadataHost = (hostname: string) => METADATA_NAMES.has(canonicalHost(hostname)) || isMetadataAddress(hostname);

// Whether connections here are kept off metadata addresses, whatever name or
// redirect leads there: for an MCP client's tool calls in the app
// (main/restricted-renders.ts), and in the headless server (src/server).
let guarded = () => false;
export const setMetadataGuard = (isGuarded: () => boolean) => {
  guarded = isGuarded;
};
export const metadataGuarded = () => guarded();

const refusal = (host: string, address?: string) => new Error(address && canonicalHost(address) !== canonicalHost(host)
  ? `Refusing to connect to ${host}: it resolves to ${address}, a cloud metadata address`
  : `Refusing to connect to ${host}: cloud metadata addresses are blocked`);

export const assertNotMetadataUrl = (url: string) => {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  if (isMetadataHost(host)) {
    throw refusal(host);
  }
};

// throws if host is, or resolves to, a metadata address (for connections
// whose address can't be checked as they're made)
export const assertNotMetadataHost = async (host: string) => {
  if (isMetadataHost(host)) {
    throw refusal(host);
  }
  const name = canonicalHost(host);
  if (net.isIP(name)) {
    return;
  }
  const addresses = await dns.promises.lookup(name, { all: true }).catch(() => []);
  const metadata = addresses.find(({ address }) => isMetadataAddress(address));
  if (metadata) {
    throw refusal(host, metadata.address);
  }
};

// dns.lookup, refusing metadata addresses: for a socket's `lookup` option
export const lookupRefusingMetadata = ((hostname: string, options: number | dns.LookupOptions, callback: (...args: unknown[]) => void) => {
  const asked = typeof options === 'number' ? { family: options } : options || {};
  dns.lookup(hostname, { ...asked, all: true }, (err, addresses) => {
    if (err) {
      return callback(err);
    }
    const metadata = addresses.find(({ address }) => isMetadataAddress(address));
    if (metadata) {
      return callback(refusal(hostname, metadata.address));
    }
    if (asked.all) {
      return callback(null, addresses);
    }
    return callback(null, addresses[0].address, addresses[0].family);
  });
}) as unknown as typeof dns.lookup;
