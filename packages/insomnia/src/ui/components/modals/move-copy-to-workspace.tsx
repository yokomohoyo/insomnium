import React, { useEffect } from 'react';
import { useFetcher } from 'react-router-dom';

import { t } from '../../../common/i18n';
import type { Workspace } from '../../../models/workspace';
import { ProjectLoaderData } from '../../routes/project';
import { HelpTooltip } from '../help-tooltip';

// the workspaces of a project, loaded once through the project route
export const useProjectWorkspaces = (organizationId: string, projectId: string): Workspace[] => {
  const workspacesFetcher = useFetcher();
  useEffect(() => {
    const isIdleAndUninitialized = workspacesFetcher.state === 'idle' && !workspacesFetcher.data;
    if (isIdleAndUninitialized) {
      workspacesFetcher.load(`/organization/${organizationId}/project/${projectId}`);
    }
  }, [organizationId, projectId, workspacesFetcher]);
  const projectLoaderData = workspacesFetcher?.data as ProjectLoaderData;
  return projectLoaderData?.workspaces.map(w => w.workspace) || [];
};

interface Props {
  help: string;
  workspaces: Workspace[];
  // left out of the list: the workspace the item is already in
  currentWorkspaceId: string;
  selectedWorkspaceId: string;
  onSelect: (workspaceId: string) => void;
  onCopy: () => void;
  onMove: () => void;
}

export const MoveCopyToWorkspace = ({ help, workspaces, currentWorkspaceId, selectedWorkspaceId, onSelect, onCopy, onMove }: Props) => (
  <div className="form-row">
    <div className="form-control form-control--outlined">
      <label>
        {t('Move/Copy to Workspace')}
        <HelpTooltip position="top" className="space-left">
          {help}
        </HelpTooltip>
        <select
          value={selectedWorkspaceId}
          onChange={event => onSelect(event.currentTarget.value)}
        >
          <option value="">{t('-- Select Workspace --')}</option>
          {workspaces
            .filter(w => currentWorkspaceId !== w._id)
            .map(w => (
              <option key={w._id} value={w._id}>
                {w.name}
              </option>
            ))
          }
        </select>
      </label>
    </div>
    <div className="form-control form-control--no-label width-auto">
      <button
        disabled={!selectedWorkspaceId}
        className="btn btn--clicky"
        onClick={() => onCopy()}
      >
        {t('Copy')}
      </button>
    </div>
    <div className="form-control form-control--no-label width-auto">
      <button
        disabled={!selectedWorkspaceId}
        className="btn btn--clicky"
        onClick={() => onMove()}
      >
        {t('Move')}
      </button>
    </div>
  </div>
);
