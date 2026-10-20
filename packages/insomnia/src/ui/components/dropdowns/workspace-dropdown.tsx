import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useFetcher, useNavigate, useParams, useRouteLoaderData } from 'react-router-dom';

import { ACTIVITY_DEBUG, ACTIVITY_SPEC, getProductName } from '../../../common/constants';
import { database as db } from '../../../common/database';
import { selectFileOrFolder } from '../../../common/select-file-or-folder';
import { t } from '../../../common/i18n';
import { RENDER_PURPOSE_NO_RENDER } from '../../../common/render';
import { isRequest } from '../../../models/request';
import { isRequestGroup } from '../../../models/request-group';
import { isDesign, Workspace } from '../../../models/workspace';
import type { WorkspaceAction } from '../../../plugins';
import { getWorkspaceActions } from '../../../plugins';
import * as pluginContexts from '../../../plugins/context';
import { guard } from '../../../utils/guard';
import { WorkspaceLoaderData } from '../../routes/workspace';
import { Dropdown, DropdownButton, type DropdownHandle, DropdownItem, DropdownSection, ItemContent } from '../base/dropdown';

import { showAlert, showError, showModal, showPrompt } from '../modals';
import { AskModal } from '../modals/ask-modal';
import { ExportRequestsModal } from '../modals/export-requests-modal';
import { configGenerators } from '../modals/generate-config-modal';
import { ImportModal } from '../modals/import-modal';
import { CaptureModal } from '../modals/capture-modal';
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
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
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
      title: t('Convert to Collection'),
      message: t('"{name}" keeps its requests and tests. Its spec is put aside, and comes back if you convert it to a design document again.', { name: activeWorkspaceName }),
      yesText: t('Convert'),
      noText: t('Cancel'),
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
        title: t('Plugin Action Failed'),
        error: err,
      });
    }
    setLoadingActions({ ...loadingActions, [label]: false });
    dropdownRef.current?.hide();
  }, [activeProject._id, loadingActions]);

  // the folder this collection is kept in step with, as readable files
  const [syncFolder, setSyncFolder] = useState<string | null>(null);
  const handleDropdownOpen = useCallback(async () => {
    const actionPlugins = await getWorkspaceActions();
    setActionPlugins(actionPlugins);
    setSyncFolder(await window.main.folderSync.status({ workspaceId: activeWorkspace._id }));
  }, [activeWorkspace._id]);
  const syncToFolder = async () => {
    const { canceled, filePath } = await selectFileOrFolder({ itemTypes: ['directory'] });
    if (canceled || !filePath) {
      return;
    }
    try {
      setSyncFolder(await window.main.folderSync.start({ workspaceId: activeWorkspace._id, folder: filePath }));
    } catch (err) {
      showAlert({ title: t('Sync to a Folder'), message: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) });
    }
  };
  const stopSyncingToFolder = async () => {
    await window.main.folderSync.stop({ workspaceId: activeWorkspace._id });
    setSyncFolder(null);
  };

  return (
    <>
      <Dropdown
        dataTestId='workspace-dropdown'
        aria-label={t('Workspace Dropdown')}
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
        <DropdownItem aria-label={t('Duplicate')}>
          <ItemContent
            label={t('Duplicate')}
            icon="copy"
            onClick={() => setIsDuplicateModalOpen(true)}
          />
        </DropdownItem>
        <DropdownItem aria-label={t('Rename')}>
          <ItemContent
            label={t('Rename')}
            icon="pen-to-square"
            onClick={() => {
              showPrompt({
                title: isDocument ? t('Rename Document') : t('Rename Collection'),
                defaultValue: activeWorkspaceName,
                submitName: t('Rename'),
                selectText: true,
                label: t('Name'),
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
        <DropdownSection aria-label={t('Meta section')}>

          <DropdownItem aria-label={t('Run Collection')}>
            <ItemContent
              icon="play"
              label={t('Run Collection')}
              onClick={() => setIsRunnerOpen(true)}
            />
          </DropdownItem>

          <DropdownItem aria-label={t('Mock Server')}>
            <ItemContent
              icon="server"
              label={t('Mock Server')}
              onClick={() => setIsMockServerOpen(true)}
            />
          </DropdownItem>

          <DropdownItem aria-label={t('Capture Traffic')}>
            <ItemContent
              icon="satellite-dish"
              label={t('Capture Traffic…')}
              onClick={() => setIsCaptureOpen(true)}
            />
          </DropdownItem>

          <DropdownItem aria-label={t('Import')}>
            <ItemContent
              icon="file-import"
              label={t('Import')}
              onClick={() => setIsImportModalOpen(true)}
            />
          </DropdownItem>

        <DropdownItem aria-label={t('Export')}>
          <ItemContent
            icon="file-export"
            label={t('Export')}
            onClick={() => setIsExportModalOpen(true)}
          />
        </DropdownItem>

          <DropdownItem aria-label={isDocument ? t('Convert to Collection') : t('Convert to Design Document')}>
            <ItemContent
              icon={isDocument ? 'bars' : 'file-code'}
              label={isDocument ? t('Convert to Collection') : t('Convert to Design Document')}
              onClick={convert}
            />
          </DropdownItem>

          <DropdownItem aria-label={syncFolder ? t('Show the Synced Folder') : t('Sync to a Folder')}>
            <ItemContent
              icon="folder-open"
              label={syncFolder ? t('Show the Synced Folder') : t('Sync to a Folder…')}
              onClick={() => (syncFolder ? window.shell.showItemInFolder(syncFolder) : syncToFolder())}
            />
          </DropdownItem>

          <DropdownItem aria-label={t('Stop Syncing to the Folder')}>
            <ItemContent
              icon="link-slash"
              label={t('Stop Syncing to the Folder')}
              isDisabled={!syncFolder}
              onClick={stopSyncingToFolder}
            />
          </DropdownItem>

          <DropdownItem aria-label={t('Settings')}>
            <ItemContent
              icon="wrench"
              label={t('Settings')}
              onClick={() => setIsSettingsModalOpen(true)}
            />
          </DropdownItem>
        </DropdownSection>
        <DropdownSection
          aria-label={t('Plugins Section')}
          title={t('Plugins')}
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
      {isCaptureOpen && (
        <CaptureModal workspace={activeWorkspace} onHide={() => setIsCaptureOpen(false)} />
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
