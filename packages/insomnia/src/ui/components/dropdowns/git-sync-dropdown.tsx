import classnames from 'classnames';
import React, { FC, Fragment, useEffect, useRef, useState } from 'react';
import { useFetcher, useParams } from 'react-router-dom';
import { useInterval } from 'react-use';

import { docsGitSync } from '../../../common/documentation';
import { t } from '../../../common/i18n';
import { GitRepository } from '../../../models/git-repository';
import { pullRequestUrl } from '../../../sync/git/pull-request-url';
import { getOauth2FormatName } from '../../../sync/git/utils';
import {
  GitFetchLoaderData,
  GitRepoLoaderData,
  GitStatusResult,
  PullFromGitRemoteResult,
  PushToGitRemoteResult,
} from '../../routes/git-actions';
import {
  Dropdown,
  DropdownButton,
  type DropdownHandle,
  DropdownItem,
  DropdownSection,
  ItemContent,
} from '../base/dropdown';
import { Link } from '../base/link';
import { HelpTooltip } from '../help-tooltip';
import { showAlert, showModal } from '../modals';
import { AskModal } from '../modals/ask-modal';
import { GitBranchesModal } from '../modals/git-branches-modal';
import { GitConflictsModal } from '../modals/git-conflicts-modal';
import { GitLogModal } from '../modals/git-log-modal';
import { GitRepositorySettingsModal } from '../modals/git-repository-settings-modal';
import { GitStagingModal } from '../modals/git-staging-modal';
import { GitStashesModal } from '../modals/git-stashes-modal';
import { GitTagsModal } from '../modals/git-tags-modal';
import { Tooltip } from '../tooltip';

interface Props {
  gitRepository: GitRepository | null;
  className?: string;
}

export const GitSyncDropdown: FC<Props> = ({ className, gitRepository }) => {
  const { organizationId, projectId, workspaceId } = useParams() as {
    organizationId: string;
    projectId: string;
    workspaceId: string;
  };
  const dropdownRef = useRef<DropdownHandle>(null);

  const [isGitRepoSettingsModalOpen, setIsGitRepoSettingsModalOpen] =
    useState(false);
  const [isGitBranchesModalOpen, setIsGitBranchesModalOpen] = useState(false);
  const [isGitLogModalOpen, setIsGitLogModalOpen] = useState(false);
  const [isGitStagingModalOpen, setIsGitStagingModalOpen] = useState(false);
  const [isGitStashesModalOpen, setIsGitStashesModalOpen] = useState(false);
  const [isGitTagsModalOpen, setIsGitTagsModalOpen] = useState(false);
  // the last pull rebased, so its conflicts pull the same way
  const [pullRebases, setPullRebases] = useState(false);

  const gitPushFetcher = useFetcher<PushToGitRemoteResult>();
  const gitPullFetcher = useFetcher<PullFromGitRemoteResult>();
  const gitCheckoutFetcher = useFetcher();
  const gitRepoDataFetcher = useFetcher<GitRepoLoaderData>();
  const gitFetchFetcher = useFetcher<GitFetchLoaderData>();
  const gitStatusFetcher = useFetcher<GitStatusResult>();

  const loadingPush = gitPushFetcher.state === 'loading';
  const loadingPull = gitPullFetcher.state === 'loading';
  const loadingFetch = gitFetchFetcher.state === 'loading';
  const loadingStatus = gitStatusFetcher.state === 'loading';

  // a repository on this computer only has no remote: no push, pull or fetch
  const hasRemote = Boolean(gitRepository?.uri);

  useEffect(() => {
    if (
      gitRepository?._id &&
      gitRepoDataFetcher.state === 'idle' &&
      !gitRepoDataFetcher.data
    ) {
      console.log('[git:fetcher] Fetching git repo data');
      gitRepoDataFetcher.submit({}, {
        action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/repo`,
        method: 'post',
      });
    }
  }, [
    gitRepoDataFetcher,
    gitRepository?._id,
    organizationId,
    projectId,
    workspaceId,
  ]);

  // the branch, and the branches, again after something that changes them:
  // a submitted fetcher's data isn't loaded again by itself
  const refreshRepoData = () => gitRepoDataFetcher.submit({}, {
    action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/repo`,
    method: 'post',
  });
  useEffect(() => {
    if (gitCheckoutFetcher.state === 'idle' && gitCheckoutFetcher.data) {
      refreshRepoData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per checkout
  }, [gitCheckoutFetcher.state, gitCheckoutFetcher.data]);

  // Only fetch the repo status if we have a repo and we don't have the status already
  const shouldFetchGitRepoStatus = Boolean(gitRepository?._id && gitStatusFetcher.state === 'idle' && !gitStatusFetcher.data && gitRepoDataFetcher.data);

  useEffect(() => {
    if (shouldFetchGitRepoStatus) {
      console.log('[git:fetcher] Fetching git repo status');
      gitStatusFetcher.submit({}, {
        action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/status`,
        method: 'post',
      });
    }
  }, [gitStatusFetcher, organizationId, projectId, shouldFetchGitRepoStatus, workspaceId]);

  useEffect(() => {
    const errors = [...(gitPushFetcher.data?.errors ?? [])];
    if (gitPushFetcher.data?.rejected) {
      // pulling merges theirs; a force push replaces the remote's branch with this one
      showModal(AskModal, {
        title: t('Push Rejected'),
        message: `${errors.join('\n')} ${t("Pull to merge them first, or force push to replace the remote's branch with yours, dropping its commits you don't have.")}`,
        yesText: t('Force Push'),
        noText: t('Cancel'),
        onDone: async (isYes: boolean) => {
          if (isYes) {
            handlePush({ force: true });
          }
        },
      });
      return;
    }
    if (errors.length > 0) {
      showAlert({
        title: t('Push Failed'),
        message: errors.join('\n'),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per push
  }, [gitPushFetcher.data]);

  useEffect(() => {
    const gitRepoDataErrors =
      gitRepoDataFetcher.data && 'errors' in gitRepoDataFetcher.data
        ? gitRepoDataFetcher.data.errors
        : [];
    const errors = [...gitRepoDataErrors];
    if (errors.length > 0) {
      showAlert({
        title: t('Loading of Git Repository Failed'),
        message: errors.join('\n'),
      });
    }
  }, [gitRepoDataFetcher.data]);

  useEffect(() => {
    const errors = [...(gitPullFetcher.data?.errors ?? [])];
    if (errors.length > 0) {
      showAlert({
        title: t('Pull Failed'),
        message: errors.join('\n'),
      });
    }
  }, [gitPullFetcher.data?.errors]);

  // what changed here and upstream, to choose between and pull again
  const [pullConflictsOpen, setPullConflictsOpen] = useState(false);
  useEffect(() => {
    setPullConflictsOpen(Boolean(gitPullFetcher.data?.conflicts?.length));
  }, [gitPullFetcher.data]);

  useEffect(() => {
    const errors = [...(gitCheckoutFetcher.data?.errors ?? [])];
    if (errors.length > 0) {
      showAlert({
        title: t('Checkout Failed'),
        message: errors.join('\n'),
      });
    }
  }, [gitCheckoutFetcher.data?.errors]);

  async function handlePush({ force }: { force: boolean }) {
    gitPushFetcher.submit(
      {
        force: `${force}`,
      },
      {
        action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/push`,
        method: 'post',
      }
    );
  }

  let iconClassName = 'fa-brands fa-git-alt';
  const providerName = getOauth2FormatName(gitRepository?.credentials);
  if (providerName === 'github') {
    iconClassName = 'fa fa-github';
  }
  if (providerName === 'gitlab') {
    iconClassName = 'fa fa-gitlab';
  }

  const isLoading =
    gitRepoDataFetcher.state === 'loading' ||
    gitFetchFetcher.state === 'loading' ||
    gitCheckoutFetcher.state === 'loading' ||
    gitPushFetcher.state === 'loading' ||
    gitPullFetcher.state === 'loading';

  const isSynced = Boolean(gitRepository?._id && gitRepoDataFetcher.data && !('errors' in gitRepoDataFetcher.data));

  const { branches, branch: currentBranch } =
    gitRepoDataFetcher.data && 'branches' in gitRepoDataFetcher.data
      ? gitRepoDataFetcher.data
      : { branches: [], branch: '' };

  let dropdown: React.ReactNode = null;

  const branchActions = [
    {
      id: 1,
      icon: 'check',
      name: 'Commit',
      label: t('Commit'),
      onClick: () => setIsGitStagingModalOpen(true),
    },
    {
      id: 2,
      stayOpenAfterClick: true,
      icon: loadingPull ? 'refresh fa-spin' : 'cloud-download',
      name: 'Pull',
      label: t('Pull'),
      onClick: async () => {
        setPullRebases(false);
        gitPullFetcher.submit(
          {},
          {
            action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/pull`,
            method: 'post',
          }
        );
      },
    },
    {
      id: 7,
      stayOpenAfterClick: true,
      icon: loadingPull ? 'refresh fa-spin' : 'cloud-download',
      name: 'Pull with Rebase',
      label: t('Pull with Rebase'),
      onClick: async () => {
        setPullRebases(true);
        gitPullFetcher.submit(
          { rebase: 'true' },
          {
            action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/pull`,
            method: 'post',
          }
        );
      },
    },
    {
      id: 3,
      stayOpenAfterClick: true,
      icon: loadingPush ? 'refresh fa-spin' : 'cloud-upload',
      name: 'Push',
      label: t('Push'),
      onClick: () => handlePush({ force: false }),
    },
    {
      id: 4,
      icon: 'clock-o',
      name: 'History',
      label: <span>{t('History')}</span>,
      onClick: () => setIsGitLogModalOpen(true),
    },
    {
      id: 5,
      stayOpenAfterClick: true,
      icon: loadingFetch ? 'refresh fa-spin' : 'refresh',
      name: 'Fetch',
      label: t('Fetch'),
      onClick: () => {
        gitFetchFetcher.submit(
          {},
          {
            action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/fetch`,
            method: 'post',
          }
        );
      },
    },
  ];

  // the host's page to propose this branch's changes, where it's known
  const pullRequestPage = hasRemote && currentBranch ? pullRequestUrl(gitRepository?.uri || '', currentBranch) : undefined;
  const currentBranchActions = [
    ...branchActions.filter(action => hasRemote || !['Pull', 'Pull with Rebase', 'Push', 'Fetch'].includes(action.name)),
    ...(pullRequestPage ? [{
      id: 6,
      icon: 'code-pull-request',
      label: t('Create Pull Request'),
      onClick: () => window.main.openInBrowser(pullRequestPage),
    }] : []),
  ];

  useInterval(() => {
    if (!hasRemote) {
      return;
    }
    gitFetchFetcher.submit(
      {},
      {
        action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/fetch`,
        method: 'post',
      }
    );
  }, 1000 * 60 * 5);

  const status = gitStatusFetcher.data?.status;

  const commitToolTipMsg = status?.localChanges ? t('Local changes made') : t('No local changes made');

  if (isSynced) {
    dropdown = (
      <div className={className}>
        <Dropdown
          dataTestId='git-dropdown'
          className="wide tall"
          ref={dropdownRef}
          triggerButton={
            <DropdownButton
              size="medium"
              variant='text'
              removePaddings={false}
              removeBorderRadius
              style={{
                width: '100%',
                borderRadius: '0',
                borderTop: '1px solid var(--hl-md)',
                justifyContent: 'flex-start !important',
                height: 'var(--line-height-sm)',
              }}
              // not disabled while the repository data refreshes (after a dialog
              // closes, say): a click then would be lost; the icon spins instead
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-start',
                  alignItems: 'center',
                  gap: 'var(--padding-xs)',
                  width: '100%',
                }}
              >
                {iconClassName && (
                  <i className={classnames('space-right', iconClassName)} />
                )}
                <div className="ellipsis">{currentBranch}</div>

                <div
                  style={{
                    opacity: loadingStatus ? 0.5 : 1,
                  }}
                >
                  <Tooltip message={commitToolTipMsg}>
                    <span
                      style={{
                        opacity: status?.localChanges ? 1 : 0.5,
                        color: status?.localChanges ? 'var(--color-notice)' : 'var(--color-hl)',
                      }}
                    ><i className={`fa fa-${isLoading ? 'refresh fa-spin' : 'cube'} space-left`} /></span>
                  </Tooltip>
                </div>
              </div>

            </DropdownButton>
          }
        >
          <DropdownSection
            title={
              <span>
                Git Sync
                <HelpTooltip>
                  {t('Sync and collaborate with Git')}{' '}
                  <Link href={docsGitSync}>
                    <span className="no-wrap">
                      <br />
                      {t('Documentation')} <i className="fa fa-external-link" />
                    </span>
                  </Link>
                </HelpTooltip>
              </span>
            }
          >
            <DropdownItem textValue={t('Settings')}>
              <ItemContent
                icon="wrench"
                label={t('Repository Settings')}
                onClick={() => {
                  setIsGitRepoSettingsModalOpen(true);
                }}
              />
            </DropdownItem>

            <DropdownItem textValue={t('Branches')}>
              {currentBranch && (
                <ItemContent
                  icon="code-fork"
                  label={t('Branches')}
                  onClick={() => {
                    setIsGitBranchesModalOpen(true);
                  }}
                />
              )}
            </DropdownItem>

            <DropdownItem textValue={t('Tags')}>
              {currentBranch && (
                <ItemContent
                  icon="tags"
                  label={t('Tags')}
                  onClick={() => setIsGitTagsModalOpen(true)}
                />
              )}
            </DropdownItem>

            <DropdownItem textValue={t('Stashes')}>
              {currentBranch && (
                <ItemContent
                  icon="archive"
                  label={t('Stashes')}
                  onClick={() => setIsGitStashesModalOpen(true)}
                />
              )}
            </DropdownItem>
          </DropdownSection>

          <DropdownSection
            title={t('Branches')}
            items={currentBranch ? branches.map(b => ({ branch: b })) : []}
          >
            {({ branch }) => {
              const isCurrentBranch = branch === currentBranch;

              return (
                <DropdownItem key={branch} textValue={branch}>
                  <ItemContent
                    className={classnames({ bold: isCurrentBranch })}
                    icon={branch === currentBranch ? 'tag' : 'empty'}
                    label={branch}
                    // not another switch while one is under way
                    isDisabled={isCurrentBranch || gitCheckoutFetcher.state !== 'idle'}
                    onClick={async () => {
                      gitCheckoutFetcher.submit(
                        {
                          branch,
                        },
                        {
                          action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/branch/checkout`,
                          method: 'post',
                        }
                      );
                    }}
                  />
                </DropdownItem>
              );
            }}
          </DropdownSection>

          <DropdownSection
            title={currentBranch}
            items={currentBranch ? currentBranchActions : []}
          >
            {({ id, ...action }) => (
              <DropdownItem
                key={id}
                textValue={
                  typeof action.label === 'string' ? action.label : `${id}`
                }
              >
                <ItemContent {...action} />
              </DropdownItem>
            )}
          </DropdownSection>
        </Dropdown>
      </div>
    );
  } else {
    dropdown = (
      <div className={className}>
        <Dropdown
          dataTestId='git-dropdown'
          className="wide tall"
          ref={dropdownRef}
          triggerButton={
            <DropdownButton
              size="medium"
              variant='text'
              removePaddings={false}
              removeBorderRadius
              style={{
                width: '100%',
                borderRadius: '0',
                borderTop: '1px solid var(--hl-md)',
                justifyContent: 'flex-start !important',
                height: 'var(--line-height-sm)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-start',
                  alignItems: 'center',
                  gap: 'var(--padding-xs)',
                  width: '100%',
                }}
              >
                {iconClassName && (
                  <i className={classnames('space-right', iconClassName)} />
                )}
                <span className="ellipsis">Git Sync</span>
              </div>

            </DropdownButton>
          }
        >
          <DropdownSection
            title={
              <span>
                Git Sync
                <HelpTooltip>
                  {t('Sync and collaborate with Git')}{' '}
                  <Link href={docsGitSync}>
                    <span className="no-wrap">
                      <br />
                      {t('Documentation')} <i className="fa fa-external-link" />
                    </span>
                  </Link>
                </HelpTooltip>
              </span>
            }
          >
            <DropdownItem textValue={t('Settings')}>
              <ItemContent
                icon="wrench"
                label={t('Setup Git Sync')}
                onClick={() => {
                  setIsGitRepoSettingsModalOpen(true);
                }}
              />
            </DropdownItem>
          </DropdownSection>
        </Dropdown>
      </div>
    );
  }

  return (
    <Fragment>
      {dropdown}
      {isGitRepoSettingsModalOpen && (
        <GitRepositorySettingsModal
          gitRepository={gitRepository ?? undefined}
          onHide={() => setIsGitRepoSettingsModalOpen(false)}
        />
      )}
      {isGitBranchesModalOpen && (
        <GitBranchesModal
          branches={branches}
          gitRepository={gitRepository}
          activeBranch={currentBranch}
          onHide={() => {
            setIsGitBranchesModalOpen(false);
            refreshRepoData();
          }}
        />
      )}
      {isGitLogModalOpen && (
        <GitLogModal
          branch={currentBranch}
          onHide={() => setIsGitLogModalOpen(false)}
        />
      )}
      {isGitStagingModalOpen && (
        <GitStagingModal onHide={() => setIsGitStagingModalOpen(false)} />
      )}
      {isGitTagsModalOpen && (
        <GitTagsModal onHide={() => setIsGitTagsModalOpen(false)} />
      )}
      {isGitStashesModalOpen && (
        <GitStashesModal
          onHide={() => {
            setIsGitStashesModalOpen(false);
            refreshRepoData();
          }}
        />
      )}
      {pullConflictsOpen && gitPullFetcher.data?.conflicts && (
        <GitConflictsModal
          theirs={t('the remote')}
          actionLabel={pullRebases ? t('Rebase') : t('Merge')}
          conflicts={gitPullFetcher.data.conflicts}
          onResolve={choices => gitPullFetcher.submit({ choices: JSON.stringify(choices), ...(pullRebases ? { rebase: 'true' } : {}) }, {
            action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/pull`,
            method: 'post',
          })}
          onHide={() => setPullConflictsOpen(false)}
        />
      )}
    </Fragment>
  );
};
