import React, { type ChangeEventHandler, type ReactNode, useEffect, useRef, useState } from 'react';
import { OverlayContainer } from 'react-aria';
import { useFetcher, useNavigate, useParams } from 'react-router-dom';

import { t } from '../../../common/i18n';
import { DEFAULT_RECONNECT } from '../../../main/network/websocket-frames';
import { tx } from '../../tx';
import { HttpVersions } from '../../../common/settings';
import * as models from '../../../models';
import { GrpcRequest, isGrpcRequest } from '../../../models/grpc-request';
import { isRequest, Request } from '../../../models/request';
import { isWebSocketRequest, WebSocketRequest } from '../../../models/websocket-request';
import { guard } from '../../../utils/guard';
import { useRequestSetter } from '../../hooks/use-request';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalHeader } from '../base/modal-header';
import { CodeEditorHandle } from '../codemirror/code-editor';
import { HelpTooltip } from '../help-tooltip';
import { MarkdownEditor } from '../markdown-editor';
import { MoveCopyToWorkspace, useProjectWorkspaces } from './move-copy-to-workspace';

export interface RequestSettingsModalOptions {
  request: Request | GrpcRequest | WebSocketRequest;
}
interface State {
  defaultPreviewMode: boolean;
  activeWorkspaceIdToCopyTo: string;
}

type PatchRequest = ReturnType<typeof useRequestSetter>;

interface CheckboxRowProps {
  label: string;
  name: string;
  checked: boolean | undefined;
  onChange: ChangeEventHandler<HTMLInputElement>;
  help?: ReactNode;
  // the tooltip sits before the box on one row, after it on the others
  helpBeforeInput?: boolean;
}

const CheckboxRow = ({ label, name, checked, onChange, help, helpBeforeInput }: CheckboxRowProps) => {
  const tooltip = help && (
    <HelpTooltip position="top" className="space-left">
      {help}
    </HelpTooltip>
  );
  return (
    <div className="form-control form-control--thin">
      <label>
        {label}
        {helpBeforeInput && tooltip}
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={onChange}
        />
        {!helpBeforeInput && tooltip}
      </label>
    </div>
  );
};

const FollowRedirectsSelect = ({ defaultValue, onChange }: { defaultValue: string; onChange: ChangeEventHandler<HTMLSelectElement> }) => (
  <div className="form-control form-control--outlined">
    <label>
      {t('Follow redirects')} <span className="txt-sm faint italic">{t('(overrides global setting)')}</span>
      <select
        defaultValue={defaultValue}
        name="settingFollowRedirects"
        onChange={onChange}
      >
        <option value={'global'}>{t('Use global setting')}</option>
        <option value={'off'}>{t("Don't follow redirects")}</option>
        <option value={'on'}>{t('Follow redirects')}</option>
      </select>
    </label>
  </div>
);

const HttpCheckboxes = ({ request, onChange }: { request: Request; onChange: ChangeEventHandler<HTMLInputElement> }) => (
  <>
    <CheckboxRow
      label={t('Automatically encode special characters in URL')}
      name="settingEncodeUrl"
      checked={request.settingEncodeUrl}
      onChange={onChange}
      help={t('Automatically encode special characters at send time (does not apply to query parameters editor)')}
    />
    <CheckboxRow
      label={t('Skip rendering of request body')}
      name="settingDisableRenderRequestBody"
      checked={request.settingDisableRenderRequestBody}
      onChange={onChange}
      help={t('Disable rendering of environment variables and tags for the request body')}
    />
    <CheckboxRow
      label={t('Rebuild path dot sequences')}
      name="settingRebuildPath"
      checked={request['settingRebuildPath']}
      onChange={onChange}
      help={t("This instructs libcurl to squash sequences of \"/../\" or \"/./\" that may exist in the URL's path part and that is supposed to be removed according to RFC 3986 section 5.2.4")}
      helpBeforeInput
    />
  </>
);

const HttpTransportSettings = ({ request, patchRequest }: { request: Request; patchRequest: PatchRequest }) => (
  <>
    <div className="form-control form-control--outlined">
      <label>
        {t('Validate certificates')} <span className="txt-sm faint italic">{t('(overrides global setting)')}</span>
        <select
          defaultValue={request.settingValidateSSL || 'global'}
          onChange={event => patchRequest(request._id, { settingValidateSSL: event.currentTarget.value as Request['settingValidateSSL'] })}
        >
          <option value={'global'}>{t('Use global setting')}</option>
          <option value={'on'}>{t('Validate certificates')}</option>
          <option value={'off'}>{t("Don't validate certificates")}</option>
        </select>
      </label>
    </div>
    <div className="form-control form-control--outlined">
      <label>
        {t('HTTP version')} <span className="txt-sm faint italic">{t('(overrides global setting)')}</span>
        <select
          defaultValue={request.settingHttpVersion || 'global'}
          onChange={event => patchRequest(request._id, { settingHttpVersion: event.currentTarget.value as Request['settingHttpVersion'] })}
        >
          <option value={'global'}>{t('Use global setting')}</option>
          <option value={HttpVersions.default}>{t('Default')}</option>
          <option value={HttpVersions.V1_0}>HTTP 1.0</option>
          <option value={HttpVersions.V1_1}>HTTP 1.1</option>
          <option value={HttpVersions.V2PriorKnowledge}>HTTP/2 PriorKnowledge</option>
          <option value={HttpVersions.V2_0}>HTTP/2</option>
        </select>
      </label>
    </div>
    <div className="form-control form-control--outlined">
      <label>
        {t('Request timeout (ms)')} <span className="txt-sm faint italic">{t('(overrides global setting; 0 for none)')}</span>
        <input
          type="number"
          min={0}
          step={100}
          placeholder={t('Use global setting')}
          defaultValue={request.settingTimeout ?? ''}
          onChange={event => {
            const { value } = event.currentTarget;
            const timeout = Number(value);
            if (value === '' || (Number.isInteger(timeout) && timeout >= 0)) {
              patchRequest(request._id, { settingTimeout: value === '' ? null : timeout });
            }
          }}
        />
      </label>
    </div>
  </>
);

const ReconnectSettings = ({ request, patchRequest }: { request: WebSocketRequest; patchRequest: PatchRequest }) => (
  <>
    <div className="form-control form-control--thin">
      <label>
        {t('Reconnect when the connection drops')}
        <input
          type="checkbox"
          checked={request.reconnect?.enabled === true}
          onChange={event => patchRequest(request._id, { reconnect: { ...DEFAULT_RECONNECT, ...request.reconnect, enabled: event.currentTarget.checked } })}
        />
      </label>
    </div>
    {request.reconnect?.enabled && (
      <div className="form-row">
        <div className="form-control form-control--outlined">
          <label>
            {t('Seconds between attempts')}
            <input
              type="number"
              min={1}
              max={300}
              defaultValue={request.reconnect.delaySeconds}
              onChange={event => {
                const delaySeconds = Number(event.currentTarget.value);
                if (delaySeconds >= 1 && delaySeconds <= 300) {
                  patchRequest(request._id, { reconnect: { ...DEFAULT_RECONNECT, ...request.reconnect, delaySeconds } });
                }
              }}
            />
          </label>
        </div>
        <div className="form-control form-control--outlined">
          <label>
            {t('Attempts in a row')}
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              defaultValue={request.reconnect.maxAttempts}
              onChange={event => {
                const maxAttempts = Number(event.currentTarget.value);
                if (Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 100) {
                  patchRequest(request._id, { reconnect: { ...DEFAULT_RECONNECT, ...request.reconnect, maxAttempts } });
                }
              }}
            />
          </label>
        </div>
      </div>
    )}
  </>
);

export const RequestSettingsModal = ({ request, onHide }: ModalProps & RequestSettingsModalOptions) => {
  const modalRef = useRef<ModalHandle>(null);
  const editorRef = useRef<CodeEditorHandle>(null);
  const { organizationId, projectId, workspaceId } = useParams() as { organizationId: string; projectId: string; workspaceId: string };
  const workspacesForActiveProject = useProjectWorkspaces(organizationId, projectId);
  const [state, setState] = useState<State>({
    defaultPreviewMode: !!request?.description,
    activeWorkspaceIdToCopyTo: '',
  });
  useEffect(() => {
    modalRef.current?.show();
  }, []);

  const requestFetcher = useFetcher();
  const patchRequest = useRequestSetter();
  const navigate = useNavigate();
  const duplicateRequest = (r: Partial<Request>) => {
    requestFetcher.submit(JSON.stringify(r),
      {
        action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/debug/request/${request._id}/duplicate`,
        method: 'post',
        encType: 'application/json',
      });
  };
  async function handleMoveToWorkspace() {
    guard(state.activeWorkspaceIdToCopyTo, 'Workspace ID is required');
    patchRequest(request._id, { parentId: state.activeWorkspaceIdToCopyTo });
    modalRef.current?.hide();
    navigate(`/organization/${organizationId}/project/${projectId}/workspace/${state.activeWorkspaceIdToCopyTo}/debug`);
  }

  async function handleCopyToWorkspace() {
    guard(state.activeWorkspaceIdToCopyTo, 'Workspace ID is required');
    duplicateRequest({ parentId: state.activeWorkspaceIdToCopyTo });
  }
  const { defaultPreviewMode, activeWorkspaceIdToCopyTo } = state;
  const toggleCheckBox = async (event: any) => {
    patchRequest(request._id, { [event.currentTarget.name]: event.currentTarget.checked ? true : false });
  };
  const updateDescription = (description: string) => {
    patchRequest(request._id, { description });
    setState({
      ...state,
      defaultPreviewMode: false,
    });
  };

  return (
    <OverlayContainer>
      <Modal ref={modalRef} onHide={onHide}>
        <ModalHeader>
          {t('Request Settings')}{' '}
          <span className="txt-sm selectable faint monospace">{request ? request._id : ''}</span>
        </ModalHeader>
        <ModalBody className="pad">
          <div>
            <div className="form-control form-control--outlined">
              <label>
                {t('Name')}{' '}
                <span className="txt-sm faint italic">{t('(also rename by double-clicking in sidebar)')}</span>
                <input
                  type="text"
                  placeholder={request?.url || t('My Request')}
                  defaultValue={request?.name}
                  onChange={event => patchRequest(request._id, { name: event.target.value })}
                />
              </label>
            </div>
            {request && (isWebSocketRequest(request) || isRequest(request)) && (
              <>
                <MarkdownEditor
                  ref={editorRef}
                  className="margin-top"
                  defaultPreviewMode={defaultPreviewMode}
                  placeholder={t('Write a description')}
                  defaultValue={request.description}
                  onChange={updateDescription}
                />
                <div className="pad-top pad-bottom">
                  <CheckboxRow
                    label={t('Send cookies automatically')}
                    name="settingSendCookies"
                    checked={request.settingSendCookies}
                    onChange={toggleCheckBox}
                  />
                  <CheckboxRow
                    label={t('Store cookies automatically')}
                    name="settingStoreCookies"
                    checked={request.settingStoreCookies}
                    onChange={toggleCheckBox}
                  />
                  {isRequest(request) && <HttpCheckboxes request={request} onChange={toggleCheckBox} />}
                </div>
                {isWebSocketRequest(request) ? (
                  <>
                    <FollowRedirectsSelect
                      defaultValue={request.settingFollowRedirects}
                      onChange={event => patchRequest(request._id, { settingFollowRedirects: event.currentTarget.value as WebSocketRequest['settingFollowRedirects'] })}
                    />
                    <ReconnectSettings request={request} patchRequest={patchRequest} />
                  </>
                ) : (
                  <>
                    <FollowRedirectsSelect
                      defaultValue={request.settingFollowRedirects}
                      // written straight to the database, unlike the other settings
                      onChange={async event => {
                        const updated = await models.request.update(request, {
                          [event.currentTarget.name]: event.currentTarget.value,
                        });
                        setState(state => ({ ...state, request: updated }));
                      }}
                    />
                    <HttpTransportSettings request={request} patchRequest={patchRequest} />
                  </>
                )}
                <hr />
                <MoveCopyToWorkspace
                  help={t("Copy or move the current request to a new workspace. It will be placed at the root of the new workspace's folder structure.")}
                  workspaces={workspacesForActiveProject}
                  currentWorkspaceId={workspaceId}
                  selectedWorkspaceId={activeWorkspaceIdToCopyTo}
                  onSelect={activeWorkspaceIdToCopyTo => setState(state => ({ ...state, activeWorkspaceIdToCopyTo }))}
                  onCopy={handleCopyToWorkspace}
                  onMove={handleMoveToWorkspace}
                />
              </>
            )}
            {request && isGrpcRequest(request) && (
              <p className="faint italic">
                {tx('Are there any gRPC settings you expect to see? Ask for them in a {link}.', {
                  link: <a href={'https://github.com/yokomohoyo/insomnium/issues/new/choose'}>{t('feature request')}</a>,
                })}
              </p>
            )}
          </div>
        </ModalBody>
      </Modal>
    </OverlayContainer>
  );
};
