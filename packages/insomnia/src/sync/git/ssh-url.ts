// SSH remotes. isomorphic-git speaks git's smart HTTP protocol only, so an SSH
// address is given to it as an https:// one on a host that can't exist
// (.invalid), which the app's HTTP client (http-client.ts) hands to the main
// process to run over SSH instead (main/git-ssh). The repository's own address,
// as typed, stays in its settings.

export interface SshAddress {
  // '' and 0 when the address has none: ~/.ssh/config's then, or git and 22
  user: string;
  host: string;
  port: number;
  // as the remote's git commands take it: relative to the user's home in the
  // scp-like form (git@host:org/repo.git), absolute in an ssh:// one
  path: string;
}

const TRANSPORT_HOST = 'ssh.insomnium.invalid';
const TRANSPORT_ORIGIN = `https://${TRANSPORT_HOST}`;

export function parseSshUrl(url: string): SshAddress | null {
  const address = url.trim();
  // ssh://[user@]host[:port]/path, and git's other spellings of it
  const full = address.match(/^(?:ssh|git\+ssh|ssh\+git):\/\/(?:([^@/]+)@)?(\[[^\]]+\]|[^:/]+)(?::(\d+))?(\/.*)$/);
  if (full) {
    const [, user, host, port, path] = full;
    // ssh://host/~user/repo is relative to a home, as git takes it
    return { user: user ? decodeURIComponent(user) : '', host: host.replace(/^\[|\]$/g, ''), port: port ? Number(port) : 0, path: path.replace(/^\/~/, '~') };
  }
  // the scp-like form, [user@]host:path, which has no :// and no slash before the colon
  const scp = address.match(/^(?:([^@/:]+)@)?(\[[^\]]+\]|[^:/]+):(?!\/\/)(.+)$/);
  if (scp && !/^[a-z]+:\/\//i.test(address) && !/^[a-zA-Z]:[\\/]/.test(address)) {
    const [, user, host, path] = scp;
    return { user: user || '', host: host.replace(/^\[|\]$/g, ''), port: 0, path };
  }
  return null;
}

export const isSshUrl = (url: string) => parseSshUrl(url) !== null;

// what isomorphic-git is given for a remote: an SSH address in https:// form
export const remoteUrlFor = (url: string) => (isSshUrl(url) ? `${TRANSPORT_ORIGIN}/${encodeURIComponent(url.trim())}` : url);

export type GitService = 'git-upload-pack' | 'git-receive-pack';

// a request isomorphic-git makes of such a remote: its refs (GET info/refs) or a service's exchange (POST)
export function sshRequestOf(url: string): { sshUrl: string; service: GitService; advertisement: boolean } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== TRANSPORT_HOST) {
    return null;
  }
  const [, encoded, ...rest] = parsed.pathname.split('/');
  const sshUrl = decodeURIComponent(encoded || '');
  const action = rest.join('/');
  const service = (action === 'info/refs' ? parsed.searchParams.get('service') : action) as GitService;
  if (!isSshUrl(sshUrl) || (service !== 'git-upload-pack' && service !== 'git-receive-pack')) {
    return null;
  }
  return { sshUrl, service, advertisement: action === 'info/refs' };
}

export const isSshTransportUrl = (url: string) => {
  try {
    return new URL(url).hostname === TRANSPORT_HOST;
  } catch {
    return false;
  }
};

// the SSH key settings a repository sends with each request, for the main process only
export const SSH_KEY_HEADER = 'x-insomnium-ssh-key';
export const SSH_PASSPHRASE_HEADER = 'x-insomnium-ssh-passphrase';
