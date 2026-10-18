// Where a command's workspaces come from, for every command: collection files
// (--collection) and Git Sync repositories (--repo, with --branch; repo.ts)

export interface Sources {
  collections: string[];
  repos: string[];
  branch?: string;
  // for private repositories (INSOMNIUM_GIT_TOKEN, INSOMNIUM_GIT_USERNAME)
  gitToken?: string;
  gitUsername?: string;
}

export const SOURCES_USAGE = `  --collection  an Insomnium or Insomnia (v4 or v5) export, or a Postman collection;
                repeat for more
  --repo        a Git Sync repository: an http(s) URL to clone, or a directory with
                a checkout of one (a mounted volume); repeat for more
  --branch      the branch of the repositories to clone (default: the remote's own)`;

export const GIT_USAGE = `  INSOMNIUM_GIT_TOKEN      a token for cloning private repositories (sent as the password)
  INSOMNIUM_GIT_USERNAME   the username to send it with, where the host needs one`;

export const emptySources = (env: Record<string, string | undefined>): Sources => ({
  collections: [],
  repos: [],
  ...(env.INSOMNIUM_GIT_TOKEN ? { gitToken: env.INSOMNIUM_GIT_TOKEN } : {}),
  ...(env.INSOMNIUM_GIT_USERNAME ? { gitUsername: env.INSOMNIUM_GIT_USERNAME } : {}),
});

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
