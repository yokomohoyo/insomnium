import React, { FunctionComponent, useEffect, useRef, useState } from 'react';

import { docsGitAccessToken } from '../../../../common/documentation';
import * as models from '../../../../models';
import { GitRepository } from '../../../../models/git-repository';
import { gitHostOf, savedGitSignIns, type SavedGitSignIn } from '../../../../sync/git/saved-sign-ins';
import { isSshUrl } from '../../../../sync/git/ssh-url';
import { Link } from '../../base/link';
import { HelpTooltip } from '../../help-tooltip';

export interface Props {
  gitRepository?: GitRepository | null;
  // transport: for an SSH address, ssh (with SSH keys) or https (its https:// form, with a token)
  onSubmit: (args: Partial<GitRepository> & { transport?: 'ssh' | 'https' }) => void;
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
  // an SSH address connects over SSH, unless its https:// form (and a token) is chosen
  const isSsh = isSshUrl(typedUri);
  const [transport, setTransport] = useState<'ssh' | 'https'>('ssh');
  const overSsh = isSsh && transport === 'ssh';
  const sshCredentials = credentials && 'sshKey' in credentials ? credentials : { sshKey: '', sshPassphrase: '' };

  return (
    <form
      id="custom"
      className='form-group'
      onSubmit={event => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        onSubmit({
          uri: formData.get('uri') as string || '',
          transport: isSsh ? transport : undefined,
          credentials: overSsh ? {
            username: '',
            token: '',
            sshKey: formData.get('sshKey') as string || '',
            sshPassphrase: formData.get('sshPassphrase') as string || '',
          } : {
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
            The repository's address: https://, or SSH, such as git@github.com:org/repo.git, which connects with your SSH keys (or, if you choose, with a token over its https:// form). Leave it empty for a repository on this computer only, with commits, branches and history; add an address here later to push it.
          </HelpTooltip>
          <input
            type="text"
            autoFocus
            name="uri"
            defaultValue={uri}
            disabled={Boolean(uri)}
            onChange={event => setTypedUri(event.currentTarget.value)}
            placeholder="https://github.com/org/repo.git, or empty for this computer only"
          />
        </label>
      </div>
      {isSsh && (
        <div className="form-control form-control--outlined">
          <label>
            Connect With
            <select
              name="transport"
              value={transport}
              disabled={Boolean(uri)}
              onChange={event => setTransport(event.currentTarget.value === 'https' ? 'https' : 'ssh')}
            >
              <option value="ssh">SSH, with my SSH keys</option>
              <option value="https">HTTPS, with a token (the address's https:// form)</option>
            </select>
          </label>
        </div>
      )}
      {!overSsh && onHost.length > 0 && (
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
      {overSsh ? (
        <>
          <div className="form-row">
            <div className="form-control form-control--outlined">
              <label>
                SSH Key File <span className="faint">(optional)</span>
                <HelpTooltip className="space-left">
                  Your SSH agent's keys are tried first, then this file, then the IdentityFile your ~/.ssh/config names for the host, then ~/.ssh/id_ed25519, id_ecdsa and id_rsa. Host aliases in ~/.ssh/config work as the address's host.
                </HelpTooltip>
                <input
                  type="text"
                  name="sshKey"
                  placeholder="~/.ssh/id_ed25519"
                  disabled={Boolean(uri)}
                  defaultValue={sshCredentials.sshKey || ''}
                />
              </label>
            </div>
            <div className="form-control form-control--outlined">
              <label>
                Passphrase <span className="faint">(for that file, if it has one)</span>
                <input
                  type="password"
                  name="sshPassphrase"
                  disabled={Boolean(uri)}
                  defaultValue={sshCredentials.sshPassphrase || ''}
                />
              </label>
            </div>
          </div>
          <p className="faint txt-sm no-margin-top">
            The first time Insomnium connects to a host, it shows the host key's fingerprint and asks before trusting it, unless your known_hosts has it already.
          </p>
        </>
      ) : (<>
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
      </>)}
    </form>
  );
};
