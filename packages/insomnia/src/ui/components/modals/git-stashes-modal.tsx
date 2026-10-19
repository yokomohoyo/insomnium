import React, { FC, useEffect, useRef, useState } from 'react';
import { OverlayContainer } from 'react-aria';
import { useFetcher, useParams } from 'react-router-dom';

import { t } from '../../../common/i18n';
import type { MergeChoice } from '../../../sync/git/merge-docs';
import { GitStashesLoaderData, GitStashResult } from '../../routes/git-actions';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';
import { PromptButton } from '../base/prompt-button';
import { TimeFromNow } from '../time-from-now';
import { GitConflictsModal } from './git-conflicts-modal';
import { showAlert } from '.';

const fileName = (file: string, names: Record<string, string>) => names[file] || file.split('/').pop() || file;

// Changes kept aside, to bring back later on this branch or another, as git
// stash does: Stash keeps every uncommitted change (the ones Roll Back could
// undo) and undoes them here.
export const GitStashesModal: FC<ModalProps> = ({ onHide }) => {
  const { organizationId, projectId, workspaceId } = useParams() as { organizationId: string; projectId: string; workspaceId: string };
  const modalRef = useRef<ModalHandle>(null);
  const action = `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/stashes`;
  const stashesFetcher = useFetcher<GitStashesLoaderData>();
  const stashFetcher = useFetcher<GitStashResult>();
  // the stash being applied, and how, for its conflicts
  const [applying, setApplying] = useState<{ id: string; intent: 'apply' | 'pop' } | null>(null);
  const [conflictsOpen, setConflictsOpen] = useState(false);

  useEffect(() => {
    modalRef.current?.show();
  }, []);
  useEffect(() => {
    if (stashesFetcher.state === 'idle' && !stashesFetcher.data) {
      stashesFetcher.load(action);
    }
  }, [action, stashesFetcher]);
  useEffect(() => {
    if (stashFetcher.state !== 'idle' || !stashFetcher.data) {
      return;
    }
    if (stashFetcher.data.errors?.length) {
      showAlert({ title: t('Stash Failed'), message: stashFetcher.data.errors.join('\n') });
    }
    setConflictsOpen(Boolean(stashFetcher.data.conflicts?.length));
    stashesFetcher.load(action);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once a stash action is done
  }, [stashFetcher.state, stashFetcher.data]);

  const apply = (id: string, intent: 'apply' | 'pop', choices?: Record<string, MergeChoice>) => {
    setApplying({ id, intent });
    stashFetcher.submit({ intent, id, ...(choices ? { choices: JSON.stringify(choices) } : {}) }, { action, method: 'post' });
  };
  const { stashes, changes, statusNames } = stashesFetcher.data || { stashes: [], changes: 0, statusNames: {} };

  return (
    <OverlayContainer>
      <Modal ref={modalRef} onHide={onHide}>
        <ModalHeader><i className="fa fa-archive space-right" />{t('Stashes')}</ModalHeader>
        <ModalBody className="pad">
          <stashFetcher.Form method="post" action={action} data-testid="git-stash-form">
            <input type="hidden" name="intent" value="stash" />
            <div className="form-row">
              <div className="form-control form-control--outlined">
                <label>
                  {t('Message')} <span className="faint">{t('(optional)')}</span>
                  <input type="text" autoFocus name="message" placeholder={t('Half done')} />
                </label>
              </div>
              <div className="form-control form-control--no-label width-auto">
                <button disabled={stashFetcher.state !== 'idle' || changes === 0} type="submit" className="btn btn--clicky">
                  <i className="fa fa-archive space-right" /> {t('Stash {count, plural, one {# Change} other {# Changes}}', { count: changes })}
                </button>
              </div>
            </div>
          </stashFetcher.Form>

          <div className="pad-top">
            <table className="table--fancy table--outlined">
              <thead>
                <tr>
                  <th className="text-left">{t('Stash')}</th>
                  <th className="text-left">{t('Made')}</th>
                  <th className="text-right">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {stashes.length === 0 && (
                  <tr><td colSpan={3} className="faint">{stashesFetcher.state === 'idle' ? t('Nothing stashed') : t('Loading…')}</td></tr>
                )}
                {stashes.map(stash => (
                  <tr key={stash.id} data-testid="git-stash">
                    <td>
                      <strong>{stash.message}</strong>
                      <div className="txt-sm faint">
                        {stash.files.map(file => fileName(file, statusNames)).join(', ')}
                      </div>
                    </td>
                    <td className="txt-sm no-wrap">
                      <TimeFromNow timestamp={stash.timestamp * 1000} intervalSeconds={30} />
                      {stash.branch && <div className="faint">{t('on {branch}', { branch: stash.branch })}</div>}
                    </td>
                    <td className="text-right no-wrap">
                      <button className="btn btn--micro btn--outlined space-left" onClick={() => apply(stash.id, 'pop')}>
                        {t('Pop')}
                      </button>
                      <button className="btn btn--micro btn--outlined space-left" onClick={() => apply(stash.id, 'apply')}>
                        {t('Apply')}
                      </button>
                      <PromptButton
                        className="btn btn--micro btn--outlined space-left"
                        doneMessage={t('Dropped')}
                        onClick={() => stashFetcher.submit({ intent: 'drop', id: stash.id }, { action, method: 'post' })}
                      >
                        {t('Drop')}
                      </PromptButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="txt-sm faint">{t('Pop applies a stash and drops it; Apply keeps it for later.')}</p>
          </div>
        </ModalBody>
        <ModalFooter>
          <div>
            <button className="btn" onClick={() => modalRef.current?.hide()}>
              {t('Done')}
            </button>
          </div>
        </ModalFooter>
      </Modal>
      {conflictsOpen && applying && stashFetcher.data?.conflicts && (
        <GitConflictsModal
          theirs={t('the stash')}
          actionLabel={t('Apply')}
          conflicts={stashFetcher.data.conflicts}
          onResolve={choices => apply(applying.id, applying.intent, choices)}
          onHide={() => setConflictsOpen(false)}
        />
      )}
    </OverlayContainer>
  );
};
