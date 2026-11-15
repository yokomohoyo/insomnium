import React, { type FC } from 'react';
import { useRouteLoaderData } from 'react-router-dom';

import type { WorkspaceLoaderData } from '../../routes/workspace';
import { GitSyncDropdown } from './git-sync-dropdown';

export const WorkspaceSyncDropdown: FC = () => {
  const { gitRepository } = useRouteLoaderData(':workspaceId') as WorkspaceLoaderData;
  return <GitSyncDropdown gitRepository={gitRepository} />;
};
