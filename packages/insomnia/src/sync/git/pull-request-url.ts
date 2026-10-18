// The page that starts a pull (or merge) request for a branch, on the hosts
// whose address for it is known: GitHub (and GitHub Enterprise), GitLab (and
// self-hosted GitLab) and Bitbucket Cloud. Other hosts get none.
export function pullRequestUrl(repositoryUri: string, branch: string): string | undefined {
  let url: URL;
  try {
    url = new URL(repositoryUri);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return undefined;
  }
  const path = url.pathname.replace(/\.git$/, '').replace(/\/+$/, '');
  if (!branch || path.split('/').filter(Boolean).length < 2) {
    return undefined;
  }
  const base = `${url.protocol}//${url.host}${path}`;
  const host = url.hostname.toLowerCase();
  const encoded = encodeURIComponent(branch);
  if (host === 'github.com' || host.includes('github')) {
    return `${base}/compare/${branch.split('/').map(encodeURIComponent).join('/')}?expand=1`;
  }
  if (host === 'gitlab.com' || host.includes('gitlab')) {
    return `${base}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encoded}`;
  }
  if (host === 'bitbucket.org') {
    return `${base}/pull-requests/new?source=${encoded}`;
  }
  return undefined;
}
