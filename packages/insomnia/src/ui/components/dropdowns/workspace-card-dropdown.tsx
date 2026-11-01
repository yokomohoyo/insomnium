import React, { FC, Fragment, useCallback, useState } from 'react';
import { useFetcher, useParams } from 'react-router-dom';

import { parseApiSpec } from '../../../common/api-specs';
import { getProductName } from '../../../common/constants';
import { t } from '../../../common/i18n';
import { RENDER_PURPOSE_NO_RENDER } from '../../../common/render';
import * as models from '../../../models';
import { CaCertificate } from '../../../models/ca-certificate';
import { ClientCertificate } from '../../../models/client-certificate';
import { Project } from '../../../models/project';
import type { Workspace } from '../../../models/workspace';
import { isDesign, WorkspaceScopeKeys } from '../../../models/workspace';
import { WorkspaceMeta } from '../../../models/workspace-meta';
import type { DocumentAction } from '../../../plugins';
import { getDocumentActions } from '../../../plugins';
import * as pluginContexts from '../../../plugins/context';
import { useLoadingRecord } from '../../hooks/use-loading-record';
import { Dropdown, DropdownButton, DropdownItem, DropdownSection, ItemContent } from '../base/dropdown';
import { showError, showModal, showPrompt } from '../modals';
import { AskModal } from '../modals/ask-modal';
import { ExportRequestsModal } from '../modals/export-requests-modal';
import { ImportModal } from '../modals/import-modal';
import { WorkspaceDuplicateModal } from '../modals/workspace-duplicate-modal';
import { WorkspaceSettingsModal } from '../modals/workspace-settings-modal';
import { SvgIcon } from '../svg-icon';

interface Props {
  workspace: Workspace;
  workspaceMeta: WorkspaceMeta;
  project: Project;
  projects: Project[];
  clientCertificates: ClientCertificate[];
  caCertificate: CaCertificate | null;
}

const useDocumentActionPlugins = ({ workspace, project }: Props) => {
  const [actionPlugins, setActionPlugins] = useState<DocumentAction[]>([]);
  const { startLoading, stopLoading, isLoading } = useLoadingRecord();

  const refresh = useCallback(async () => {
    // Only load document plugins if the scope is design, for now
    if (workspace.scope === WorkspaceScopeKeys.design) {
      setActionPlugins(await getDocumentActions());
    }
  }, [workspace.scope]);

  const handleClick = useCallback(async (p: DocumentAction) => {
    startLoading(p.label);

    try {
      const context = {
        ...pluginContexts.app.init(RENDER_PURPOSE_NO_RENDER),
        ...pluginContexts.data.init(project._id),
        ...pluginContexts.store.init(p.plugin),
      };
      // read now: the projects page doesn't keep every spec's text
      const apiSpec = await models.apiSpec.getByParentId(workspace._id);
      await p.action(context, parseApiSpec(apiSpec?.contents || ''));
    } catch (err) {
      showError({
        title: t('Document Action Failed'),
        error: err,
      });
    } finally {
      stopLoading(p.label);
    }
  }, [workspace._id, project._id, startLoading, stopLoading]);

  const renderPluginDropdownItems: any = useCallback(() => actionPlugins.map(p => (
    <DropdownItem
      key={`${p.plugin.name}:${p.label}`}
      aria-label={p.label}
    >
      <ItemContent
        icon={isLoading(p.label) ? 'refresh fa-spin' : undefined}
        label={p.label}
        stayOpenAfterClick={!p.hideAfterClick}
        onClick={() => handleClick(p)}
      />
    </DropdownItem>
  )), [actionPlugins, handleClick, isLoading]);

  return { renderPluginDropdownItems, refresh };
};

export const WorkspaceCardDropdown: FC<Props> = props => {
  const { workspace, project, projects, workspaceMeta, clientCertificates, caCertificate } = props;
  const fetcher = useFetcher();
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const {
    organizationId,
    projectId,
  } = useParams() as { organizationId: string; projectId: string };

  const workspaceName = workspace.name;
  const projectName = project.name ?? getProductName();
  const { refresh, renderPluginDropdownItems } = useDocumentActionPlugins(props);
  return (
    <Fragment>
      <Dropdown
        aria-label={t('Workspace Actions Dropdown')}
        onOpen={refresh}
        triggerButton={
          <DropdownButton aria-label={t('Workspace actions menu button')} className="px-4 py-1 flex flex-1 items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] rounded-sm text-[--color-font] hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all text-sm">
            <SvgIcon icon="ellipsis" />
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
                title: isDesign(workspace) ? t('Rename Document') : t('Rename Collection'),
                defaultValue: workspaceName,
                submitName: t('Rename'),
                selectText: true,
                label: t('Name'),
                onComplete: name =>
                  fetcher.submit(
                    { name, workspaceId: workspace._id },
                    {
                      action: `/organization/${organizationId}/project/${workspace.parentId}/workspace/update`,
                      method: 'post',
                      encType: 'application/json',
                    }
                  ),
              });
            }}
          />
        </DropdownItem>
        <DropdownSection aria-label={t('Meta section')}>
          <DropdownItem aria-label={t('Import')}>
            <ItemContent
              label={t('Import')}
              icon="file-import"
              onClick={() => setIsImportModalOpen(true)}
            />
          </DropdownItem>
          <DropdownItem aria-label={t('Export')}>
            <ItemContent
              label={t('Export')}
              icon="file-export"
              onClick={() => setIsExportModalOpen(true)}
            />
          </DropdownItem>
          <DropdownItem aria-label={t('Settings')}>
            <ItemContent
              label={t('Settings')}
              icon="gear"
              onClick={() => setIsSettingsModalOpen(true)}
            />
          </DropdownItem>
        </DropdownSection>
        {renderPluginDropdownItems()}

        <DropdownSection aria-label={t('Delete section')}>
          <DropdownItem aria-label={t('Delete')}>
            <ItemContent
              label={t('Delete')}
              icon="trash-o"
              className="danger"
              onClick={() => {
                showModal(AskModal, {
                  title: isDesign(workspace) ? t('Delete Document') : t('Delete Collection'),
                  message: t('Do you really want to delete "{name}"?', { name: workspaceName }),
                  yesText: t('Yes'),
                  noText: t('Cancel'),
                  onDone: async (isYes: boolean) => {
                    if (!isYes) {
                      return;
                    }

                    fetcher.submit(
                      { workspaceId: workspace._id },
                      {
                        action: `/organization/${organizationId}/project/${workspace.parentId}/workspace/delete`,
                        method: 'post',
                      }
                    );
                  },
                });
              }}
            />
          </DropdownItem>
        </DropdownSection>
      </Dropdown>
      {isDuplicateModalOpen && (
        <WorkspaceDuplicateModal
          onHide={() => setIsDuplicateModalOpen(false)}
          workspace={workspace}
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
          defaultWorkspaceId={workspace._id}
        />
      )}
      {isExportModalOpen && (
        <ExportRequestsModal
          workspace={workspace}
          onHide={() => setIsExportModalOpen(false)}
        />
      )}
      {isSettingsModalOpen && (
        <WorkspaceSettingsModal
          workspace={workspace}
          workspaceMeta={workspaceMeta}
          clientCertificates={clientCertificates}
          caCertificate={caCertificate}
          onHide={() => setIsSettingsModalOpen(false)}
        />
      )}
    </Fragment>
  );
};
