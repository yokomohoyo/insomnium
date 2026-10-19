import React, { FC, Fragment, useEffect, useState } from 'react';
import { useFetcher, useParams } from 'react-router-dom';
import { useRouteLoaderData } from 'react-router-dom';

import { getProductName } from '../../../common/constants';
import { docsImportExport } from '../../../common/documentation';
import { exportAllToFile } from '../../../common/export';
import { t } from '../../../common/i18n';
import { isDesign } from '../../../models/workspace';
import { ProjectLoaderData } from '../../routes/project';
import { WorkspaceLoaderData } from '../../routes/workspace';
import { Dropdown, DropdownButton, DropdownItem, DropdownSection, ItemContent } from '../base/dropdown';
import { Link } from '../base/link';
import { ExportRequestsModal } from '../modals/export-requests-modal';
import { ImportModal } from '../modals/import-modal';
import { Button } from '../themed-button';
interface Props {
  hideSettingsModal: () => void;
}

export const ImportExport: FC<Props> = ({ hideSettingsModal }) => {
  const {
    organizationId,
    projectId,
    workspaceId,
  } = useParams() as { organizationId: string; projectId: string; workspaceId?: string };

  const workspaceData = useRouteLoaderData(':workspaceId') as WorkspaceLoaderData | undefined;
  const activeWorkspaceName = workspaceData?.activeWorkspace.name;
  const projectName = workspaceData?.activeProject.name ?? getProductName();

  const workspacesFetcher = useFetcher();
  useEffect(() => {
    const isIdleAndUninitialized = workspacesFetcher.state === 'idle' && !workspacesFetcher.data;
    if (isIdleAndUninitialized) {
      workspacesFetcher.load(`/organization/${organizationId}/project/${projectId}`);
    }
  }, [organizationId, projectId, workspacesFetcher]);
  const projectLoaderData = workspacesFetcher?.data as ProjectLoaderData;
  const workspacesForActiveProject = projectLoaderData?.workspaces.map(w => w.workspace) || [];
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const handleExportAllToFile = () => {
    exportAllToFile(projectName, workspacesForActiveProject);
    hideSettingsModal();
  };
  return (
    <Fragment>
      <div data-testid="import-export-tab">
        <div className="no-margin-top">
          {t('Import format will be automatically detected.')}
        </div>
        <p>
          {t("Your format isn't supported?")} <Link href={docsImportExport}>{t('Add Your Own')}</Link>.
        </p>
        <div className="pad-top">
          {workspaceData?.activeWorkspace ?
            (<Dropdown
              aria-label={t('Export Data Dropdown')}
              triggerButton={
                <DropdownButton className="btn btn--clicky">
                  {t('Export Data')} <i className="fa fa-caret-down" />
                </DropdownButton>
              }
            >
              <DropdownSection
                aria-label={t('Choose Export Type')}
                title={t('Choose Export Type')}
              >
                <DropdownItem aria-label={(isDesign(workspaceData.activeWorkspace) ? t('Export the "{name}" document', { name: workspaceData.activeWorkspace.name }) : t('Export the "{name}" collection', { name: workspaceData.activeWorkspace.name }))}>
                  <ItemContent
                    icon="home"
                    label={(isDesign(workspaceData.activeWorkspace) ? t('Export the "{name}" document', { name: workspaceData.activeWorkspace.name }) : t('Export the "{name}" collection', { name: workspaceData.activeWorkspace.name }))}
                    onClick={() => setIsExportModalOpen(true)}
                  />
                </DropdownItem>
                <DropdownItem aria-label={t('Export files from the "{name}" project', { name: projectName })}>
                  <ItemContent
                    icon="empty"
                    label={t('Export files from the "{name}" project', { name: projectName })}
                    onClick={handleExportAllToFile}
                  />
                </DropdownItem>
              </DropdownSection>
            </Dropdown>) : (<Button onClick={handleExportAllToFile}>{t('Export files from the "{name}" project', { name: projectName })}</Button>)
          }
          &nbsp;&nbsp;
          <Button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--padding-sm)',
            }}
            onClick={() => setIsImportModalOpen(true)}
          >
            <i className="fa fa-file-import" />
            {t('Import to the "{name}" project', { name: projectName })}
          </Button>
        </div>
      </div>
      {isImportModalOpen && (
        <ImportModal
          onHide={() => setIsImportModalOpen(false)}
          from={{ type: 'file' }}
          projectName={projectName}
          workspaceName={activeWorkspaceName}
          organizationId={organizationId}
          defaultProjectId={projectId}
          defaultWorkspaceId={workspaceId}
        />
      )}
      {isExportModalOpen && workspaceData?.activeWorkspace && (
        <ExportRequestsModal
          workspace={workspaceData.activeWorkspace}
          onHide={() => setIsExportModalOpen(false)}
        />
      )}
    </Fragment>
  );
};
