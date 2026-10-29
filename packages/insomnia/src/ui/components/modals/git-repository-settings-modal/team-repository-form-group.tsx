import React, { FunctionComponent, useCallback, useEffect, useState } from 'react';

import { docsGitSync } from '../../../../common/documentation';
import { t } from '../../../../common/i18n';
import type { TeamServerSignIn } from '../../../../common/settings';
import { isPlainHttpOffMachine, type TeamCollection, type TeamServerKey } from '../../../../common/team-server';
import * as models from '../../../../models';
import type { GitRepository } from '../../../../models/git-repository';
import { Link } from '../../base/link';
import { HelpTooltip } from '../../help-tooltip';
import type { Props as CustomProps } from './custom-repository-settings-form-group';

interface Props {
  // clone: one of the collections to copy here; share: the one to sync this workspace to
  mode: 'clone' | 'share';
  onSubmit: CustomProps['onSubmit'];
}

const ADD = '+';
const keyOf = (server: TeamServerKey) => `${server.username}@${server.url}`;
const message = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// A team server's collections, to clone or to sync to, with the sign-in kept in
// Preferences (an access token, never the password)
export const TeamRepositoryFormGroup: FunctionComponent<Props> = ({ mode, onSubmit }) => {
  const [servers, setServers] = useState<TeamServerSignIn[]>([]);
  const [selected, setSelected] = useState('');
  const [collections, setCollections] = useState<TeamCollection[] | null>(null);
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [author, setAuthor] = useState({ name: '', email: '' });
  const [signIn, setSignIn] = useState({ url: '', username: '', password: '' });
  const [newName, setNewName] = useState('');

  const loadServers = useCallback(async (select?: TeamServerKey) => {
    const settings = await models.settings.getOrCreate();
    const list = settings.teamServers || [];
    setServers(list);
    setSelected(current => select ? keyOf(select) : list.some(server => keyOf(server) === current) ? current : list[0] ? keyOf(list[0]) : ADD);
  }, []);

  useEffect(() => {
    loadServers();
    // the author of the last repository set up, as a start
    models.gitRepository.all().then(repositories => {
      const last = [...repositories].sort((a, b) => b.modified - a.modified).find(repository => repository.author?.email);
      if (last) {
        setAuthor(last.author);
      }
    });
  }, [loadServers]);

  const server = servers.find(item => keyOf(item) === selected);

  const loadCollections = useCallback(async (target: TeamServerKey, pick?: string) => {
    setCollections(null);
    setError('');
    try {
      const list = await window.main.team.collections({ url: target.url, username: target.username });
      setCollections(list);
      setSlug(pick || '');
    } catch (err) {
      setCollections([]);
      setError(message(err));
    }
  }, []);

  useEffect(() => {
    if (server) {
      loadCollections(server);
      setAuthor(current => current.name ? current : { ...current, name: server.username });
    } else {
      setCollections(null);
    }
  }, [server, loadCollections]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const connect = () => run(async () => {
    const connected = await window.main.team.connect(signIn);
    setSignIn({ url: '', username: '', password: '' });
    await loadServers(connected);
  });

  const disconnect = () => server && run(async () => {
    await window.main.team.disconnect({ url: server.url, username: server.username });
    await loadServers();
  });

  const create = () => server && run(async () => {
    const collection = await window.main.team.create({ url: server.url, username: server.username, name: newName });
    setNewName('');
    await loadCollections(server, collection.slug);
  });

  // a viewer can clone, but not push
  const usable = (collection: TeamCollection) => mode === 'clone' || collection.role !== 'viewer';
  const chosen = collections?.find(collection => collection.slug === slug && usable(collection));

  return (
    <form
      id="team"
      className="form-group"
      onSubmit={event => {
        event.preventDefault();
        if (!server || !chosen) {
          setError(t('Choose a collection'));
          return;
        }
        const patch: Partial<GitRepository> = {
          uri: chosen.cloneUrl,
          credentials: { username: server.username, token: server.token },
          author,
        };
        onSubmit(patch);
      }}
    >
      <p className="faint">
        {t('Collections on a team server of your own: run `insomnium-server team` on a NAS or a server on your network.')}{' '}
        <Link href={docsGitSync}>{t('Documentation')} <i className="fa fa-external-link-square" /></Link>
      </p>
      <div className="form-control form-control--outlined">
        <label>
          {t('Team Server')}
          <select
            value={selected}
            onChange={event => setSelected(event.currentTarget.value)}
            data-testid="team-server-select"
          >
            {servers.map(item => (
              <option key={keyOf(item)} value={keyOf(item)}>{item.username} @ {item.url}</option>
            ))}
            <option value={ADD}>{t('Sign in to a team server…')}</option>
          </select>
        </label>
      </div>

      {selected === ADD && (
        <>
          <div className="form-control form-control--outlined">
            <label>
              {t('Address')}
              <input
                type="text"
                autoFocus
                value={signIn.url}
                onChange={event => setSignIn({ ...signIn, url: event.currentTarget.value })}
                placeholder="https://nas.example.com"
                data-testid="team-server-url"
              />
            </label>
          </div>
          {isPlainHttpOffMachine(signIn.url) && (
            <p className="notice warning">
              {t('Over plain http://, anyone on the network can read your password and token. Put the server behind HTTPS.')}
            </p>
          )}
          <div className="form-row">
            <div className="form-control form-control--outlined">
              <label>
                {t('Username')}
                <input
                  type="text"
                  value={signIn.username}
                  onChange={event => setSignIn({ ...signIn, username: event.currentTarget.value })}
                  data-testid="team-server-username"
                />
              </label>
            </div>
            <div className="form-control form-control--outlined">
              <label>
                {t('Password or Access Token')}
                <HelpTooltip className="space-left">
                  {t('A password signs in once: Insomnium makes an access token for this computer, keeps that, and forgets the password.')}
                </HelpTooltip>
                <input
                  type="password"
                  value={signIn.password}
                  onChange={event => setSignIn({ ...signIn, password: event.currentTarget.value })}
                  data-testid="team-server-password"
                />
              </label>
            </div>
          </div>
          <button
            type="button"
            className="btn btn--clicky"
            disabled={busy || !signIn.url.trim() || !signIn.username.trim() || !signIn.password}
            onClick={connect}
            data-testid="team-server-sign-in"
          >
            {busy ? <i className="fa fa-spin fa-refresh" /> : t('Sign In')}
          </button>
        </>
      )}

      {server && (
        <>
          <div className="form-control form-control--outlined">
            <label>
              {mode === 'clone' ? t('Collection to Clone') : t('Collection to Sync To')}
              {collections === null ? (
                <div className="faint"><i className="fa fa-spin fa-refresh" /> {t('Loading…')}</div>
              ) : collections.length === 0 ? (
                <div className="faint">{t('No collections you can use yet.')}</div>
              ) : (
                <select
                  value={slug}
                  onChange={event => setSlug(event.currentTarget.value)}
                  data-testid="team-collection-select"
                >
                  <option value="" disabled>{t('Choose a collection…')}</option>
                  {collections.map(collection => (
                    <option key={collection.slug} value={collection.slug} disabled={!usable(collection)}>
                      {collection.name} ({collection.slug}) · {collection.role}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </div>
          {mode === 'share' && (
            <div className="form-row">
              <div className="form-control form-control--outlined">
                <label>
                  {t('Or a New Collection')}
                  <input
                    type="text"
                    value={newName}
                    onChange={event => setNewName(event.currentTarget.value)}
                    placeholder={t('Name')}
                    data-testid="team-collection-name"
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn btn--clicky"
                style={{ alignSelf: 'flex-end' }}
                disabled={busy || !newName.trim()}
                onClick={create}
                data-testid="team-collection-create"
              >
                {t('Create')}
              </button>
            </div>
          )}
          <div className="form-row">
            <div className="form-control form-control--outlined">
              <label>
                {t('Author Name')}
                <input
                  required
                  type="text"
                  value={author.name}
                  onChange={event => setAuthor({ ...author, name: event.currentTarget.value })}
                  placeholder={t('Name')}
                />
              </label>
            </div>
            <div className="form-control form-control--outlined">
              <label>
                {t('Author Email')}
                <input
                  required
                  type="email"
                  value={author.email}
                  onChange={event => setAuthor({ ...author, email: event.currentTarget.value })}
                  placeholder={t('Email')}
                />
              </label>
            </div>
          </div>
          <button type="button" className="btn btn--clicky btn--compact" disabled={busy} onClick={disconnect}>
            {t('Sign Out of {url}', { url: server.url })}
          </button>
        </>
      )}

      {error && <p className="notice error">{error}</p>}
    </form>
  );
};
