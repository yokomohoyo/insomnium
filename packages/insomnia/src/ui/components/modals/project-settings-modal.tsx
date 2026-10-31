import React, { FC, useEffect, useRef } from 'react';
import { OverlayContainer } from 'react-aria';
import { useFetcher, useParams } from 'react-router-dom';

import { t } from '../../../common/i18n';
import { Project } from '../../../models/project';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalHeader } from '../base/modal-header';
import { PromptButton } from '../base/prompt-button';

export interface ProjectSettingsModalProps extends ModalProps {
  project: Project;
}

export const ProjectSettingsModal: FC<ProjectSettingsModalProps> = ({ project, onHide }) => {
  const modalRef = useRef<ModalHandle>(null);
  const { organizationId } = useParams<{organizationId: string}>();
  const { submit } = useFetcher();

  useEffect(() => {
    modalRef.current?.show();
  }, []);

  return (
    <OverlayContainer>
      <Modal onHide={onHide} ref={modalRef}>
        <ModalHeader key={`header::${project._id}`}>
          {t('Project Settings')}{' '}
          <div className="txt-sm selectable faint monospace">{project._id}</div>
        </ModalHeader>
        <ModalBody key={`body::${project._id}`} className="pad">
          <div className="form-control form-control--outlined">
            <label>
              {t('Name')}
              <input
                type="text"
                placeholder={t('My Project')}
                defaultValue={project.name}
                onChange={e => {
                  // a project needs a name: a blank one isn't saved
                  if (!e.currentTarget.value.trim()) {
                    return;
                  }
                  submit(
                    {
                      name: e.currentTarget.value,
                    },
                    {
                      action: `/organization/${organizationId}/project/${project._id}/rename`,
                      method: 'post',
                    }
                  );
                }}
              />
            </label>
          </div>
          <h2 className="mt-[--padding-lg]">{t('Actions')}</h2>
          <div className="form-control form-control--padded flex flex-wrap items-center gap-[--padding-sm]">
            <PromptButton
              onClick={() =>
                submit(
                  {},
                  { method: 'post', action: `/organization/${organizationId}/project/${project._id}/delete` }
                )
              }
              className="width-auto btn btn--clicky"
            >
              <i className="fa fa-trash-o" /> {t('Delete')}
            </PromptButton>
          </div>
        </ModalBody>
      </Modal>
    </OverlayContainer>
  );
};

ProjectSettingsModal.displayName = 'ProjectSettingsModal';

export default ProjectSettingsModal;
