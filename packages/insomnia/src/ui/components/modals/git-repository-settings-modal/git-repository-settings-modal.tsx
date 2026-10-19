import React, { useEffect, useRef } from 'react';
import { OverlayContainer } from 'react-aria';
import { useFetcher, useParams } from 'react-router-dom';
import styled from 'styled-components';

import { t } from '../../../../common/i18n';
import type { GitRepository } from '../../../../models/git-repository';
import { Link } from '../../base/link';
import { Modal, type ModalHandle, ModalProps } from '../../base/modal';
import { ModalBody } from '../../base/modal-body';
import { ModalFooter } from '../../base/modal-footer';
import { ModalHeader } from '../../base/modal-header';
import { PanelContainer, TabItem, Tabs } from '../../base/tabs';
import { ErrorBoundary } from '../../error-boundary';
import { HelpTooltip } from '../../help-tooltip';
import { showAlert } from '..';
import { CustomRepositorySettingsFormGroup } from './custom-repository-settings-form-group';

const TabPill = styled.div({
  display: 'flex',
  gap: 'var(--padding-xs)',
  alignItems: 'center',
});

export const GitRepositorySettingsModal = (props: ModalProps & {
  gitRepository?: GitRepository;
}) => {
  const { organizationId, projectId, workspaceId } = useParams() as { organizationId: string; projectId: string; workspaceId: string };
  const { gitRepository } = props;
  const modalRef = useRef<ModalHandle>(null);
  const updateGitRepositoryFetcher = useFetcher();
  const deleteGitRepositoryFetcher = useFetcher();


  useEffect(() => {
    modalRef.current?.show();
  }, []);

  const onSubmit = (gitRepositoryPatch: Partial<GitRepository> & { transport?: 'ssh' | 'https' }) => {
    const {
      author,
      credentials,
      created,
      modified,
      isPrivate,
      needsFullClone,
      uriNeedsMigration,
      ...repoPatch
    } = gitRepositoryPatch;

    updateGitRepositoryFetcher.submit(
      {
        ...repoPatch,
        authorName: author?.name || '',
        authorEmail: author?.email || '',
        ...credentials,
      },
      {
        action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/update`,
        method: 'post',
      }
    );
  };

  const isLoading = updateGitRepositoryFetcher.state !== 'idle';
  const hasGitRepository = Boolean(gitRepository);
  const errors = updateGitRepositoryFetcher.data?.errors as (Error | string)[];

  useEffect(() => {
    if (errors && errors.length) {
      const errorMessage = errors.map(e => e instanceof Error ? e.message : typeof e === 'string' && e).join(', ');

      showAlert({
        title: t('Error Cloning Repository'),
        message: errorMessage,
      });
    }
  }, [errors]);

  return (
    <OverlayContainer>
      <Modal ref={modalRef} {...props}>
        <ModalHeader>
          {t('Git Settings')}

        </ModalHeader>
        <ModalBody>
          <ErrorBoundary>
            <Tabs
              isDisabled={isLoading || hasGitRepository}
              aria-label={t('Git repository settings tabs')}
            >
              <TabItem key='custom' title={<TabPill><i className="fa fa-code-fork" /> Git</TabPill>}>
                <PanelContainer className="pad pad-top-sm">
                  <CustomRepositorySettingsFormGroup
                    gitRepository={gitRepository}
                    onSubmit={onSubmit}
                  />
                </PanelContainer>
              </TabItem>
            </Tabs>
          </ErrorBoundary>
        </ModalBody>
        <ModalFooter>
          <div
            style={{
              display: 'flex',
              gap: 'var(--padding-md)',
            }}
          >
            <button
              className="btn"
              disabled={!gitRepository}
              onClick={() => {
                deleteGitRepositoryFetcher.submit({}, {
                  action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/git/reset`,
                  method: 'post',
                });
              }}
            >
              {t('Reset')}
            </button>
            {hasGitRepository ? (
              <button
                type="button"
                onClick={() => modalRef.current?.hide()}
                className="btn"
                data-testid="git-repository-settings-modal__sync-btn-close"
              >
                {t('Close')}
              </button>
            ) : (
              <button
                type="submit"
                disabled={isLoading}
                form="custom"
                className="btn"
                data-testid="git-repository-settings-modal__sync-btn"
              >
                {t('Sync')}
              </button>
            )}
          </div>
        </ModalFooter>
      </Modal>
    </OverlayContainer>
  );
};
