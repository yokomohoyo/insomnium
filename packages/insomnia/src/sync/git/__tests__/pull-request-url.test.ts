import { describe, expect, it } from '@jest/globals';

import { pullRequestUrl } from '../pull-request-url';

describe('pullRequestUrl()', () => {
  it("opens the host's page to start a pull request for the branch", () => {
    expect(pullRequestUrl('https://github.com/acme/pets.git', 'add-owners')).toBe('https://github.com/acme/pets/compare/add-owners?expand=1');
    expect(pullRequestUrl('https://github.acme.com/team/pets', 'feature/owners')).toBe('https://github.acme.com/team/pets/compare/feature/owners?expand=1');
    expect(pullRequestUrl('https://gitlab.com/acme/group/pets.git', 'add owners')).toBe('https://gitlab.com/acme/group/pets/-/merge_requests/new?merge_request%5Bsource_branch%5D=add%20owners');
    expect(pullRequestUrl('https://gitlab.acme.com/pets/', 'x')).toBeUndefined();
    expect(pullRequestUrl('https://gitlab.acme.com/acme/pets/', 'x')).toBe('https://gitlab.acme.com/acme/pets/-/merge_requests/new?merge_request%5Bsource_branch%5D=x');
    expect(pullRequestUrl('https://bitbucket.org/acme/pets.git', 'x')).toBe('https://bitbucket.org/acme/pets/pull-requests/new?source=x');
  });

  it('has none for other hosts, other schemes, or no branch', () => {
    expect(pullRequestUrl('https://git.example.com/acme/pets.git', 'x')).toBeUndefined();
    expect(pullRequestUrl('ssh://github.com/acme/pets.git', 'x')).toBeUndefined();
    expect(pullRequestUrl('', 'x')).toBeUndefined();
    expect(pullRequestUrl('https://github.com/acme/pets.git', '')).toBeUndefined();
  });
});
