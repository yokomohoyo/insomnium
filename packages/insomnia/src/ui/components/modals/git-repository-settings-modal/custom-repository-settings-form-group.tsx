import React, { FunctionComponent, useEffect, useRef, useState } from 'react';

import { docsGitAccessToken } from '../../../../common/documentation';
import * as models from '../../../../models';
import { GitRepository } from '../../../../models/git-repository';
import { gitHostOf, savedGitSignIns, type SavedGitSignIn } from '../../../../sync/git/saved-sign-ins';
import { Link } from '../../base/link';
import { HelpTooltip } from '../../help-tooltip';

export interface Props {
  gitRepository?: GitRepository | null;
  onSubmit: (args: Partial<GitRepository>) => void;
}

export const CustomRepositorySettingsFormGroup: FunctionComponent<Props> = ({
  gitRepository,
  onSubmit,
}) => {
  const linkIcon = <i className="fa fa-external-link-square" />;
  const defaultValues = gitRepository || { uri: '', credentials: { username: '', token: '' }, author: { name: '', email: '' } };

  const uri = defaultValues.uri;
  const author = defaultValues.author;
  const credentials = defaultValues?.credentials || { username: '', token: '' };

  // the sign-ins of the other repositories on the host typed, to reuse
  const [typedUri, setTypedUri] = useState(uri);
  const [signIns, setSignIns] = useState<SavedGitSignIn[]>([]);
  const usernameRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    models.gitRepository.all().then(repositories => setSignIns(savedGitSignIns(repositories)));
  }, []);
  const host = gitHostOf(typedUri);
  const onHost = uri ? [] : signIns.filter(signIn => signIn.host === host);

  return (
    <form
      id="custom"
      className='form-group'
      onSubmit={event => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        onSubmit({
          uri: formData.get('uri') as string || '',
          credentials: {
            username: formData.get('username') as string || '',
            token: formData.get('token') as string || '',
          },
          author: {
            name: formData.get('authorName') as string || '',
            email: formData.get('authorEmail') as string || '',
          },
        });
      }}
    >
      <div className="form-control form-control--outlined">
        <label>
          Git URI
          <HelpTooltip className="space-left">
            The repository's https:// address. An SSH address, such as git@github.com:org/repo.git, works too: Git Sync uses its https:// form.
          </HelpTooltip>
          <input
            type="text"
            required
            autoFocus
            name="uri"
            defaultValue={uri}
            disabled={Boolean(uri)}
            onChange={event => setTypedUri(event.currentTarget.value)}
            placeholder="https://github.com/org/repo.git"
          />
        </label>
      </div>
      {onHost.length > 0 && (
        <div className="form-control form-control--outlined">
          <label>
            Saved sign-in for {host}
            <select
              defaultValue=""
              onChange={event => {
                const signIn = onHost[Number(event.currentTarget.value)];
                if (signIn && usernameRef.current && tokenRef.current) {
                  usernameRef.current.value = signIn.username;
                  tokenRef.current.value = signIn.token;
                }
              }}
            >
              <option value="" disabled>Use the sign-in of another repository on {host}…</option>
              {onHost.map((signIn, index) => (
                <option key={signIn.username} value={index}>{signIn.username}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="form-row">
        <div className="form-control form-control--outlined">
          <label>
            Author Name
            <input
              required
              type="text"
              name="authorName"
              placeholder="Name"
              disabled={Boolean(uri)}
              defaultValue={author.name}
            />
          </label>
        </div>
        <div className="form-control form-control--outlined">
          <label>
            Author Email
            <input
              required
              type="text"
              name="authorEmail"
              placeholder="Email"
              disabled={Boolean(uri)}
              defaultValue={author.email}
            />
          </label>
        </div>
      </div>
      <div className="form-row">
        <div className="form-control form-control--outlined">
          <label>
            Username
            <input
              ref={usernameRef}
              type="text"
              name="username"
              placeholder="MyUser"
              disabled={Boolean(uri)}
              defaultValue={credentials?.username}
            />
          </label>
        </div>
        <div className="form-control form-control--outlined">
          <label>
            Authentication Token
            <HelpTooltip className="space-left">
              Create a personal access token
              <br />
              <Link href={docsGitAccessToken.github}>GitHub {linkIcon}</Link>
              {' | '}
              <Link href={docsGitAccessToken.gitlab}>GitLab {linkIcon}</Link>
              {' | '}
              <Link href={docsGitAccessToken.bitbucket}>Bitbucket {linkIcon}</Link>
              {' | '}
              <Link href={docsGitAccessToken.bitbucketServer}>
                Bitbucket Server {linkIcon}
              </Link>
              {' | '}
              <Link href={docsGitAccessToken.azureDevOps}>
                Azure DevOps {linkIcon}
              </Link>
            </HelpTooltip>
            <input
              ref={tokenRef}
              type="password"
              name="token"
              disabled={Boolean(uri)}
              defaultValue={'token' in credentials ? credentials?.token : ''}
              placeholder="88e7ee63b254e4b0bf047559eafe86ba9dd49507"
            />
          </label>
        </div>
      </div>
      <p className="faint txt-sm no-margin-top">
        For a public repository you only clone and pull from, the username and token can be left empty.
      </p>
    </form>
  );
};
