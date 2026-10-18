import type { GitRepository } from '../../models/git-repository';

// The host of a repository address: https:// or ssh:// URLs, and the scp-like
// git@host:org/repo form
export const gitHostOf = (uri: string) => {
  const scp = /^[\w.-]+@([^:/\s]+):/.exec(uri.trim());
  if (scp) {
    return scp[1].toLowerCase();
  }
  try {
    return new URL(uri.trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export interface SavedGitSignIn {
  host: string;
  username: string;
  token: string;
}

// The username and token sign-ins saved with repositories, one per host and
// username, to reuse for another repository on the same host
export const savedGitSignIns = (repositories: GitRepository[]): SavedGitSignIn[] => {
  const signIns = new Map<string, SavedGitSignIn>();
  for (const { uri, credentials } of repositories) {
    // a username and token is kept as { username, password }
    if (!credentials || !('password' in credentials)) {
      continue;
    }
    const host = gitHostOf(uri);
    if (host && credentials.username && credentials.password) {
      signIns.set(`${host}\n${credentials.username}`, { host, username: credentials.username, token: credentials.password });
    }
  }
  return [...signIns.values()];
};
