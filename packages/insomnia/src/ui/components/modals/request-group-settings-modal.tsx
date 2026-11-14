import React, { useEffect, useRef, useState } from 'react';
import { OverlayContainer } from 'react-aria';
import { useFetcher, useNavigate, useParams } from 'react-router-dom';

import { getCommonHeaderNames, getCommonHeaderValues } from '../../../common/common-headers';
import type { AuthType } from '../../../common/constants';
import { t } from '../../../common/i18n';
import { getAuthStrategies, type RequestAuthenticationStrategy, type RequestHeader } from '../../../models/request';
import type { RequestGroup } from '../../../models/request-group';
import { guard } from '../../../utils/guard';
import { useRequestGroupPatcher } from '../../hooks/use-request';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalHeader } from '../base/modal-header';
import { CodeEditorHandle } from '../codemirror/code-editor';
import { AuthStrategyDropdown } from '../dropdowns/auth-dropdown';
import { AuthStrategiesEditor } from '../editors/auth/auth-wrapper';
import { KeyValueEditor } from '../key-value-editor/key-value-editor';
import { MarkdownEditor } from '../markdown-editor';
import { MoveCopyToWorkspace, useProjectWorkspaces } from './move-copy-to-workspace';

// OAuth 2 keeps its tokens per request, so a folder can't hold one yet
const FOLDER_AUTH_TYPES: AuthType[] = ['apikey', 'basic', 'digest', 'oauth1', 'ntlm', 'iam', 'bearer', 'hawk', 'asap', 'gcp-id-token', 'jwt', 'edgegrid', 'netrc'];

export interface RequestGroupSettingsModalOptions {
  requestGroup: RequestGroup;
}
interface State {
  defaultPreviewMode: boolean;
  activeWorkspaceIdToCopyTo: string;
}
export const RequestGroupSettingsModal = ({ requestGroup, onHide }: ModalProps & {
  requestGroup: RequestGroup;
}) => {
  const modalRef = useRef<ModalHandle>(null);
  const editorRef = useRef<CodeEditorHandle>(null);
  const { organizationId, projectId, workspaceId } = useParams() as { organizationId: string; projectId: string; workspaceId: string };
  const workspacesForActiveProject = useProjectWorkspaces(organizationId, projectId);
  const [state, setState] = useState<State>({
    activeWorkspaceIdToCopyTo: '',
    defaultPreviewMode: !!requestGroup.description,
  });
  const patchRequestGroup = useRequestGroupPatcher();
  // edited here, not read back from the folder: the modal keeps the folder it
  // opened with
  const [authentication, setAuthentication] = useState(() => getAuthStrategies(requestGroup.authentication));
  const [headers, setHeaders] = useState<RequestHeader[]>(() => requestGroup.headers || []);
  const saveAuthentication = (next: RequestAuthenticationStrategy[]) => {
    setAuthentication(next);
    patchRequestGroup(requestGroup._id, { authentication: next });
  };
  const saveHeaders = (next: RequestHeader[]) => {
    setHeaders(next);
    patchRequestGroup(requestGroup._id, { headers: next });
  };
  const requestFetcher = useFetcher();

  const duplicateRequestGroup = (r: Partial<RequestGroup>) => {
    requestFetcher.submit(JSON.stringify(r),
      {
        action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/debug/request-group/duplicate`,
        method: 'post',
        encType: 'application/json',
      });
  };
  useEffect(() => {
    modalRef.current?.show();
  }, []);
  const navigate = useNavigate();
  const handleMoveToWorkspace = async () => {
    guard(state.activeWorkspaceIdToCopyTo, 'Workspace ID is required');
    patchRequestGroup(requestGroup._id, { parentId: state.activeWorkspaceIdToCopyTo });
    modalRef.current?.hide();
    navigate(`/organization/${organizationId}/project/${projectId}/workspace/${state.activeWorkspaceIdToCopyTo}/debug`);
  };

  const handleCopyToWorkspace = async () => {
    guard(state.activeWorkspaceIdToCopyTo, 'Workspace ID is required');
    duplicateRequestGroup({
      _id: requestGroup._id,
      name: requestGroup.name, // Because duplicate will add (Copy) suffix if name is not provided in patch
      parentId: state.activeWorkspaceIdToCopyTo,
    });
  };

  const {
    defaultPreviewMode,
    activeWorkspaceIdToCopyTo,
  } = state;
  return (
    <OverlayContainer onClick={e => e.stopPropagation()}>
      <Modal ref={modalRef} onHide={onHide}>
        <ModalHeader>
          {t('Folder Settings')}{' '}
          <span className="txt-sm selectable faint monospace">
            {requestGroup?._id || ''}
          </span>
        </ModalHeader>
        <ModalBody className="pad"><div>
          <div className="form-control form-control--outlined">
            <label>
              {t('Name')}
              <input
                type="text"
                placeholder={requestGroup?.name || t('My Folder')}
                defaultValue={requestGroup?.name}
                onChange={async event => {
                  guard(requestGroup, 'No request group');
                  // a blank name isn't saved
                  if (event.target.value.trim()) {
                    patchRequestGroup(requestGroup._id, { name: event.target.value });
                  }
                }}
              />
            </label>
          </div>
          <MarkdownEditor
            ref={editorRef}
            className="margin-top"
            defaultPreviewMode={defaultPreviewMode}
            placeholder={t('Write a description')}
            defaultValue={requestGroup?.description || ''}
            onChange={async (description: string) => {
              guard(requestGroup, 'No request group');
              patchRequestGroup(requestGroup._id, { description });
            }}
          />
          <hr />
          <section aria-label={t('Folder auth')}>
            <div className="flex items-center">
              <strong className="flex-1">{t('Auth')}</strong>
              <AuthStrategyDropdown authentication={authentication} onChange={saveAuthentication} authTypes={FOLDER_AUTH_TYPES} withPlugins />
            </div>
            <p className="faint txt-sm">
              {t('Requests in this folder, and in folders inside it, that have no auth of their own use this.')}
            </p>
            {authentication.length > 0 && <AuthStrategiesEditor authentication={authentication} onChange={saveAuthentication} editableTypes={[...FOLDER_AUTH_TYPES, 'plugin']} />}
          </section>
          <section aria-label={t('Folder headers')} className="margin-top">
            <strong>{t('Headers')}</strong>
            <p className="faint txt-sm">
              {t('Sent with every request in this folder, unless the request sets the same header. A folder inside it can override them.')}
            </p>
            <KeyValueEditor
              namePlaceholder={t('header')}
              valuePlaceholder={t('value')}
              pairs={headers}
              handleGetAutocompleteNameConstants={getCommonHeaderNames}
              handleGetAutocompleteValueConstants={getCommonHeaderValues}
              onChange={saveHeaders}
            />
          </section>
          <hr />
          <MoveCopyToWorkspace
            help={t("Copy or move the current folder to a new workspace. It will be placed at the root of the new workspace's folder structure.")}
            workspaces={workspacesForActiveProject}
            currentWorkspaceId={workspaceId}
            selectedWorkspaceId={activeWorkspaceIdToCopyTo}
            onSelect={activeWorkspaceIdToCopyTo => setState(state => ({ ...state, activeWorkspaceIdToCopyTo }))}
            onCopy={handleCopyToWorkspace}
            onMove={handleMoveToWorkspace}
          />
        </div></ModalBody>
      </Modal>
    </OverlayContainer>
  );
};
