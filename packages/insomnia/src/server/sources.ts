// Where a command's workspaces come from, for every command: collection files
// (--collection) and Git Sync repositories (--repo, with --branch; repo.ts)

export interface Sources {
  collections: string[];
  repos: string[];
  branch?: string;
  // for private repositories (INSOMNIUM_GIT_TOKEN, INSOMNIUM_GIT_USERNAME), and
  // the host it's for (INSOMNIUM_GIT_TOKEN_HOST)
  gitToken?: string;
  gitUsername?: string;
  gitTokenHost?: string;
}

export const SOURCES_USAGE = `  --collection  an Insomnium or Insomnia (v4 or v5) export, or a Postman collection;
                repeat for more
  --repo        a Git Sync repository: an http(s) URL to clone, or a directory with
                a checkout of one (a mounted volume); repeat for more
  --branch      the branch of the repositories to clone (default: the remote's own)`;

export const GIT_USAGE = `  INSOMNIUM_GIT_TOKEN      a token for cloning private repositories (sent as the password,
                           over https only)
  INSOMNIUM_GIT_USERNAME   the username to send it with, where the host needs one
  INSOMNIUM_GIT_TOKEN_HOST the host it's for (github.com), needed with repositories on several`;

export const emptySources = (env: Record<string, string | undefined>): Sources => ({
  collections: [],
  repos: [],
  ...(env.INSOMNIUM_GIT_TOKEN ? { gitToken: env.INSOMNIUM_GIT_TOKEN } : {}),
  ...(env.INSOMNIUM_GIT_USERNAME ? { gitUsername: env.INSOMNIUM_GIT_USERNAME } : {}),
  ...(env.INSOMNIUM_GIT_TOKEN_HOST ? { gitTokenHost: env.INSOMNIUM_GIT_TOKEN_HOST } : {}),
});

// the token goes to one host: with repositories cloned from several, say which
export const assertOneTokenHost = (sources: Pick<Sources, 'repos' | 'gitToken' | 'gitTokenHost'>) => {
  const hosts = new Set(sources.repos.filter(repo => /^https?:\/\//i.test(repo)).map(repo => new URL(repo).host.toLowerCase()));
  if (sources.gitToken && !sources.gitTokenHost && hosts.size > 1) {
    throw new Error(`INSOMNIUM_GIT_TOKEN would go to ${[...hosts].join(' and ')}: set INSOMNIUM_GIT_TOKEN_HOST to the host it's for`);
  }
};

// Takes a source option into sources: false when it's another option
export const takeSourceOption = (sources: Sources, option: string, value: () => string) => {
  switch (option) {
    case '--collection':
      sources.collections.push(value());
      return true;
    case '--repo':
      sources.repos.push(value());
      return true;
    case '--branch':
      sources.branch = value();
      return true;
    default:
      return false;
  }
};

export const requireSources = (sources: Sources) => {
  if (!sources.collections.length && !sources.repos.length) {
    throw new Error('Give at least one --collection or --repo');
  }
};
