import classnames from 'classnames';
import React, { FC, useEffect, useRef, useState } from 'react';
import { OverlayContainer } from 'react-aria';
import { useFetcher, useParams } from 'react-router-dom';

import { t } from '../../../common/i18n';
import { GitRepository } from '../../../models/git-repository';
import { CreateNewGitBranchResult, GitBranchesLoaderData, MergeGitBranchResult } from '../../routes/git-actions';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';
import { PromptButton } from '../base/prompt-button';
import { GitConflictsModal } from './git-conflicts-modal';
import { showAlert } from '.';

type Props = ModalProps & {
  activeBranch: string;
  gitRepository: GitRepository | null;
  branches: string[];
};

export interface GitBranchesModalOptions {
  onCheckout: () => void;
}

export const GitBranchesModal: FC<Props> = (({
  branches,
  onHide,
  activeBranch,
}) => {
  const { organizationId, projectId, workspaceId } = useParams() as { organizationId: string; projectId: string; workspaceId: string};
  const modalRef = useRef<ModalHandle>(null);

  useEffect(() => {
    modalRef.current?.show();
  }, []);

  const branchesFetcher = useFetcher<GitBranchesLoaderData>();
  const checkoutBranchFetcher = useFetcher();
  const mergeBranchFetcher = useFetcher<MergeGitBranchResult>();
  // the branch being merged in (or rebased onto), and the documents both sides changed
  const [merging, setMerging] = useState('');
  const how = useRef<'merge' | 'rebase'>('merge');
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const merge = (branch: string, choices?: object, way: 'merge' | 'rebase' = how.current) => {
    setMerging(branch);
    how.current = way;
    mergeBranchFetcher.submit({ branch, ...(choices ? { choices: JSON.stringify(choices) } : {}) }, {
      action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/branch/${way}`,
      method: 'post',
    });
  };
  useEffect(() => {
    if (mergeBranchFetcher.data?.errors?.length) {
      showAlert({ title: how.current === 'rebase' ? t('Rebase Failed') : t('Merge Failed'), message: mergeBranchFetcher.data.errors.join('\n') });
    }
    setConflictsOpen(Boolean(mergeBranchFetcher.data?.conflicts?.length));
  }, [mergeBranchFetcher.data]);
  const newBranchFetcher = useFetcher<CreateNewGitBranchResult>();
  const deleteBranchFetcher = useFetcher();

  // const errors = branchesFetcher.data && 'errors' in branchesFetcher.data ? branchesFetcher.data.errors : [];
  const { remoteBranches, branches: localBranches, branch: checkedOut } = branchesFetcher.data && 'branches' in branchesFetcher.data ? branchesFetcher.data : { branches: [], remoteBranches: [], branch: '' };
  // as it is now: the menu's can be from before a checkout here (the loader runs again after each)
  const currentBranch = checkedOut || activeBranch;

  const fetchedBranches = localBranches.length > 0 ? localBranches : branches;
  const remoteOnlyBranches = remoteBranches.filter(b => !fetchedBranches.includes(b));
  const isFetchingRemoteBranches = branchesFetcher.state !== 'idle';

  useEffect(() => {
    if (branchesFetcher.state === 'idle' && !branchesFetcher.data) {
      branchesFetcher.load(`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/branches`);
    }
  }, [branchesFetcher, organizationId, projectId, workspaceId]);

  useEffect(() => {
    if (newBranchFetcher.data?.errors?.length) {
      showAlert({
        title: t('Create Branch Failed'),
        message: newBranchFetcher.data.errors.join('\n'),
      });
    }
  }, [newBranchFetcher.data?.errors]);

  return (
    <OverlayContainer>
      <Modal ref={modalRef} onHide={onHide}>
        <ModalHeader><i className={`fa fa-code-fork space-left ${isFetchingRemoteBranches ? 'fa-fade' : ''}`} /> {t('Branches')}</ModalHeader>
        <ModalBody className="pad">
          <newBranchFetcher.Form
            method="post"
            action={`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/branch/new`}
          >
            <div className="form-row">
              <div className="form-control form-control--outlined">
                <label>
                  {t('New Branch Name')}
                  <input
                    type="text"
                    autoFocus
                    name="branch"
                    required
                    placeholder="testing-branch"
                  />
                </label>
              </div>
              <div className="form-control form-control--no-label width-auto">
                <button disabled={newBranchFetcher.state === 'loading'} type="submit" className="btn btn--clicky">
                  <i className='fa fa-plus space-right' /> {t('Create')}
                </button>
              </div>
            </div>
          </newBranchFetcher.Form>

          <div className="pad-top">
            <table className="table--fancy table--outlined">
              <thead>
                <tr>
                  <th className="text-left">{t('Branches')}</th>
                  <th className="text-right">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {fetchedBranches.map(branch => (
                  <tr key={branch} className="table--no-outline-row">
                    <td>
                      <span
                        className={classnames({
                          bold: branch === currentBranch,
                        })}
                      >
                        {branch}
                      </span>
                      {branch === currentBranch ? (
                        <span className="txt-sm space-left">{t('(current)')}</span>
                      ) : null}
                    </td>
                    <td className="text-right">
                      {branch !== currentBranch && (
                        <>
                          <PromptButton
                            className="btn btn--micro btn--outlined space-left"
                            doneMessage={t('Merged')}
                            onClick={async () => merge(branch, undefined, 'merge')}
                          >
                            {t('Merge')}
                          </PromptButton>
                          <PromptButton
                            className="btn btn--micro btn--outlined space-left"
                            doneMessage={t('Rebased')}
                            onClick={async () => merge(branch, undefined, 'rebase')}
                          >
                            {t('Rebase onto')}
                          </PromptButton>
                          <PromptButton
                            className="btn btn--micro btn--outlined space-left"
                            doneMessage={t('Deleted')}
                            onClick={async () => {
                              deleteBranchFetcher.submit({
                                branch,
                              }, {
                                action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/branch/delete`,
                                method: 'post',
                              });
                            }}
                          >
                            {t('Delete')}
                          </PromptButton>
                          <button
                            className="btn btn--micro btn--outlined space-left"
                            onClick={() => {
                              checkoutBranchFetcher.submit({
                                branch,
                              }, {
                                action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/branch/checkout`,
                                method: 'post',
                              });
                            }}
                          >
                            {t('Checkout')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Boolean(isFetchingRemoteBranches && !remoteOnlyBranches.length) && (
            <div className="pad-top">
              <div className="txt-sm faint italic">
                <i className="fa fa-spinner fa-spin space-right" />
                {t('Fetching remote branches...')}
              </div>
            </div>
          )}
          {remoteOnlyBranches.length > 0 && (
            <div className="pad-top">
              <table className="table--fancy table--outlined">
                <thead>
                  <tr>
                    <th className="text-left">{t('Remote Branches')} {isFetchingRemoteBranches && <i className="fa fa-spinner fa-spin space-right" />}</th>
                    <th className="text-right">&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {remoteOnlyBranches.map(branch => (
                    <tr key={branch} className="table--no-outline-row">
                      <td>{branch}</td>
                      <td className="text-right">
                        <button
                          className="btn btn--micro btn--outlined space-left"
                          onClick={async () => {
                            checkoutBranchFetcher.submit({
                              branch,
                            }, {
                              action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/branch/checkout`,
                              method: 'post',
                            });
                          }}
                        >
                          {t('Checkout')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <div className="margin-left italic txt-sm">
            <i className="fa fa-code-fork" /> {currentBranch}
          </div>
          <div>
            <button className="btn" onClick={() => modalRef.current?.hide()}>
              {t('Done')}
            </button>
          </div>
        </ModalFooter>
      </Modal>
      {conflictsOpen && mergeBranchFetcher.data?.conflicts && (
        <GitConflictsModal
          theirs={merging}
          actionLabel={how.current === 'rebase' ? t('Rebase') : t('Merge')}
          conflicts={mergeBranchFetcher.data.conflicts}
          onResolve={choices => merge(merging, choices)}
          onHide={() => setConflictsOpen(false)}
        />
      )}
    </OverlayContainer>
  );
});
GitBranchesModal.displayName = 'GitBranchesModal';
