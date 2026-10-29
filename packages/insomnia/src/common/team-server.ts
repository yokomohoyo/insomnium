// What the app and a team server (`insomnium-server team`, server/team) share:
// its collections as the API lists them, and how a typed address is read.

export type TeamRole = 'viewer' | 'editor' | 'owner';

export interface TeamCollection {
  slug: string;
  name: string;
  role: TeamRole;
  cloneUrl: string;
  created: number;
  createdBy: string;
}

export interface TeamServerKey {
  url: string;
  username: string;
}

// the address as it's typed, without the /api a copied link may have
export function normalizeTeamUrl(typed: string) {
  let url = typed.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${typed.trim() || 'An empty address'} isn't a server address`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('A team server address starts with https:// or http://');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Leave the user name and password out of the address');
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '').replace(/\/api$/, '')}`;
}

// plain HTTP is fine on this computer; anywhere else it sends the token in the clear
export const isPlainHttpOffMachine = (url: string) => {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
};
