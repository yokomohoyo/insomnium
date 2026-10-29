import React, { FC } from 'react';
import { Link, useParams } from 'react-router-dom';

import { t } from '../../common/i18n';

// The way back from Tests, Flows and the like to the collection's requests
export const BackToRequests: FC = () => {
  const { organizationId, projectId, workspaceId } = useParams() as { organizationId: string; projectId: string; workspaceId: string };
  return (
    <Link
      to={`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/debug`}
      className="flex items-center gap-[--padding-xs] px-[--padding-sm] py-[--padding-xs] text-[--hl] hover:text-[--color-font] hover:bg-[--hl-xs] no-underline hover:no-underline border-b border-solid border-[--hl-md]"
      data-testid="back-to-requests"
    >
      <i className="fa fa-arrow-left" /> {t('Back to Requests')}
    </Link>
  );
};
