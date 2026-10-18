import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useFetcher, useNavigate, useParams, useRouteLoaderData } from 'react-router-dom';

import { ACTIVITY_DEBUG, ACTIVITY_SPEC, getProductName } from '../../../common/constants';
import { database as db } from '../../../common/database';
import { getWorkspaceLabel } from '../../../common/get-workspace-label';
import { RENDER_PURPOSE_NO_RENDER } from '../../../common/render';
import { isRequest } from '../../../models/request';
import { isRequestGroup } from '../../../models/request-group';
import { isDesign, Workspace } from '../../../models/workspace';
import type { WorkspaceAction } from '../../../plugins';
import { getWorkspaceActions } from '../../../plugins';
import * as pluginContexts from '../../../plugins/context';
import { guard } from '../../../utils/guard';
import { useAIContext } from '../../context/app/ai-context';
import { WorkspaceLoaderData } from '../../routes/workspace';
import { Dropdown, DropdownButton, type DropdownHandle, DropdownItem, DropdownSection, ItemContent } from '../base/dropdown';

import { showError, showModal, showPrompt } from '../modals';
import { AskModal } from '../modals/ask-modal';
import { ExportRequestsModal } from '../modals/export-requests-modal';
import { configGenerators, showGenerateConfigModal } from '../modals/generate-config-modal';
import { ImportModal } from '../modals/import-modal';
import { MockServerModal } from '../modals/mock-server-modal';
import { RunnerModal } from '../modals/runner-modal';
import { WorkspaceDuplicateModal } from '../modals/workspace-duplicate-modal';
import { WorkspaceSettingsModal } from '../modals/workspace-settings-modal';

console.log("[configGenerators] ", configGenerators);

export const WorkspaceDropdown: FC = () => {
  const { organizationId, projectId, workspaceId } = useParams<{ organizationId: string; projectId: string; workspaceId: string }>();
  guard(organizationId, 'Expected organizationId');
  const {
    activeWorkspace,
    activeWorkspaceMeta,
    activeProject,
    activeApiSpec,
    clientCertificates,
    caCertificate,
    projects,
  } = useRouteLoaderData(':workspaceId') as WorkspaceLoaderData;
  const activeWorkspaceName = activeWorkspace.name;
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isRunnerOpen, setIsRunnerOpen] = useState(false);
  const [isMockServerOpen, setIsMockServerOpen] = useState(false);
  const workspaceName = activeWorkspace.name;
  const projectName = activeProject.name ?? getProductName();
  const fetcher = useFetcher();
  // a collection gets a spec, and a document gives one up (kept, for if it
  // becomes a document again)
  const isDocument = isDesign(activeWorkspace);
  const convertFetcher = useFetcher();
  const navigate = useNavigate();
  const converted = convertFetcher.data as { scope: string } | undefined;
  useEffect(() => {
    if (convertFetcher.state === 'idle' && converted) {
      navigate(`/organization/${organizationId}/project/${activeWorkspace.parentId}/workspace/${activeWorkspace._id}/${converted.scope === 'design' ? ACTIVITY_SPEC : ACTIVITY_DEBUG}`);
    }
  }, [convertFetcher.state, converted, navigate, organizationId, activeWorkspace.parentId, activeWorkspace._id]);
  const convert = () => {
    const submit = () => convertFetcher.submit(
      { scope: isDocument ? 'collection' : 'design' },
      { action: `/organization/${organizationId}/project/${activeWorkspace.parentId}/workspace/${activeWorkspace._id}/convert`, method: 'post', encType: 'application/json' },
    );
    if (!isDocument) {
      submit();
      return;
    }
    showModal(AskModal, {
      title: 'Convert to Collection',
      message: `"${activeWorkspaceName}" keeps its requests and tests. Its spec is put aside, and comes back if you convert it to a design document again.`,
      yesText: 'Convert',
      noText: 'Cancel',
      onDone: async (isYes: boolean) => {
        if (isYes) {
          submit();
        }
      },
    });
  };

  const [actionPlugins, setActionPlugins] = useState<WorkspaceAction[]>([]);
  const [loadingActions, setLoadingActions] = useState<Record<string, boolean>>({});
  const dropdownRef = useRef<DropdownHandle>(null);

  const handlePluginClick = useCallback(async ({ action, plugin, label }: WorkspaceAction, workspace: Workspace) => {
    setLoadingActions({ ...loadingActions, [label]: true });
    try {
      const context = {
        ...(pluginContexts.app.init(RENDER_PURPOSE_NO_RENDER) as Record<string, any>),
        ...pluginContexts.data.init(activeProject._id),
        ...(pluginContexts.store.init(plugin) as Record<string, any>),
        ...(pluginContexts.network.init() as Record<string, any>),
      };

      const docs = await db.withDescendants(workspace);
      const requests = docs
        .filter(isRequest)
        .filter(doc => (
          !doc.isPrivate
        ));
      const requestGroups = docs.filter(isRequestGroup);
      await action(context, {
        requestGroups,
        requests,
        workspace,
      });
    } catch (err) {
      showError({
        title: 'Plugin Action Failed',
        error: err,
      });
    }
    setLoadingActions({ ...loadingActions, [label]: false });
    dropdownRef.current?.hide();
  }, [activeProject._id, loadingActions]);

  const handleDropdownOpen = useCallback(async () => {
    const actionPlugins = await getWorkspaceActions();
    setActionPlugins(actionPlugins);
  }, []);

  const handleGenerateConfig = useCallback((label: string) => {
    if (!activeApiSpec) {
      return;
    }
    showGenerateConfigModal({
      apiSpec: activeApiSpec,
      activeTabLabel: label,
    });
  }, [activeApiSpec]);

  return (
    <>
      <Dropdown
        dataTestId='workspace-dropdown'
        aria-label="Workspace Dropdown"
        ref={dropdownRef}
        closeOnSelect={false}
        className="wide workspace-dropdown"
        onOpen={handleDropdownOpen}
        triggerButton={
          <DropdownButton className="row">
            <div
              className="ellipsis"
              style={{
                maxWidth: '400px',
              }}
              title={activeWorkspaceName}
            >
              {activeWorkspaceName}
            </div>
            <i className="fa fa-caret-down space-left" />
          </DropdownButton>
        }
      >
        <DropdownItem aria-label='Duplicate'>
          <ItemContent
            label="Duplicate"
            icon="copy"
            onClick={() => setIsDuplicateModalOpen(true)}
          />
        </DropdownItem>
        <DropdownItem aria-label='Rename'>
          <ItemContent
            label="Rename"
            icon="pen-to-square"
            onClick={() => {
              showPrompt({
                title: `Rename ${getWorkspaceLabel(activeWorkspace).singular}`,
                defaultValue: activeWorkspaceName,
                submitName: 'Rename',
                selectText: true,
                label: 'Name',
                onComplete: name =>
                  fetcher.submit(
                    { name, workspaceId: activeWorkspace._id },
                    {
                      action: `/organization/${organizationId}/project/${activeWorkspace.parentId}/workspace/update`,
                      method: 'post',
                      encType: 'application/json',
                    }
                  ),
              });
            }}
          />
        </DropdownItem>
        <DropdownSection aria-label='Meta section'>

          <DropdownItem aria-label='Run Collection'>
            <ItemContent
              icon="play"
              label="Run Collection"
              onClick={() => setIsRunnerOpen(true)}
            />
          </DropdownItem>

          <DropdownItem aria-label='Mock Server'>
            <ItemContent
              icon="server"
              label="Mock Server"
              onClick={() => setIsMockServerOpen(true)}
            />
          </DropdownItem>

          <DropdownItem aria-label='Import'>
            <ItemContent
              icon="file-import"
              label="Import"
              onClick={() => setIsImportModalOpen(true)}
            />
          </DropdownItem>

        <DropdownItem aria-label='Export'>
          <ItemContent
            icon="file-export"
            label="Export"
            onClick={() => setIsExportModalOpen(true)}
          />
        </DropdownItem>

          <DropdownItem aria-label={isDocument ? 'Convert to Collection' : 'Convert to Design Document'}>
            <ItemContent
              icon={isDocument ? 'bars' : 'file-code'}
              label={isDocument ? 'Convert to Collection' : 'Convert to Design Document'}
              onClick={convert}
            />
          </DropdownItem>

          <DropdownItem aria-label="Settings">
            <ItemContent
              icon="wrench"
              label="Settings"
              onClick={() => setIsSettingsModalOpen(true)}
            />
          </DropdownItem>
        </DropdownSection>
        <DropdownSection
          aria-label='Plugins Section'
          title="Plugins"
        >
          {actionPlugins.map((p: WorkspaceAction) => (
            <DropdownItem
              key={p.label}
              aria-label={p.label}
            >
              <ItemContent
                icon={loadingActions[p.label] ? 'refresh fa-spin' : p.icon || 'code'}
                label={p.label}
                stayOpenAfterClick
                onClick={() => handlePluginClick(p, activeWorkspace)}
              />
            </DropdownItem>
          ))}
        </DropdownSection>

      </Dropdown>
      {isMockServerOpen && (
        <MockServerModal workspace={activeWorkspace} onHide={() => setIsMockServerOpen(false)} />
      )}
      {isRunnerOpen && (
        <RunnerModal
          parentId={activeWorkspace._id}
          name={activeWorkspaceName}
          onHide={() => setIsRunnerOpen(false)}
        />
      )}
      {isDuplicateModalOpen && (
        <WorkspaceDuplicateModal
          onHide={() => setIsDuplicateModalOpen(false)}
          workspace={activeWorkspace}
          projects={projects}
        />
      )}
      {isImportModalOpen && (
        <ImportModal
          onHide={() => setIsImportModalOpen(false)}
          from={{ type: 'file' }}
          projectName={projectName}
          workspaceName={workspaceName}
          organizationId={organizationId}
          defaultProjectId={projectId}
          defaultWorkspaceId={workspaceId}
        />
      )}
      {isExportModalOpen && (
        <ExportRequestsModal
          workspace={activeWorkspace}
          onHide={() => setIsExportModalOpen(false)}
        />
      )}
      {isSettingsModalOpen && (
        <WorkspaceSettingsModal
          workspace={activeWorkspace}
          workspaceMeta={activeWorkspaceMeta}
          clientCertificates={clientCertificates}
          caCertificate={caCertificate}
          onHide={() => setIsSettingsModalOpen(false)}
        />
      )}
    </>
  );
};
