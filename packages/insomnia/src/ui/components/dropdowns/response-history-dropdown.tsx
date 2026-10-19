import { differenceInHours, differenceInMinutes, isThisWeek, isToday } from 'date-fns';
import React, { useCallback, useRef } from 'react';
import { useFetcher, useRevalidator, useRouteLoaderData } from 'react-router-dom';
import { useParams } from 'react-router-dom';

import { t } from '../../../common/i18n';
import { decompressObject } from '../../../common/misc';
import * as models from '../../../models/index';
import { isRequest, Request } from '../../../models/request';
import { Response } from '../../../models/response';
import { WebSocketRequest } from '../../../models/websocket-request';
import { isWebSocketResponse, WebSocketResponse } from '../../../models/websocket-response';
import { useRequestMetaPatcher } from '../../hooks/use-request';
import { RequestLoaderData, WebSocketRequestLoaderData } from '../../routes/request';
import { WorkspaceLoaderData } from '../../routes/workspace';
import { Dropdown, DropdownButton, type DropdownHandle, DropdownItem, DropdownSection, ItemContent } from '../base/dropdown';
import { useDocBodyKeyboardShortcuts } from '../keydown-binder';
import { SizeTag } from '../tags/size-tag';
import { StatusTag } from '../tags/status-tag';
import { TimeTag } from '../tags/time-tag';
import { URLTag } from '../tags/url-tag';
import { TimeFromNow } from '../time-from-now';

export const ResponseHistoryDropdown = ({
  activeResponse,
}: { activeResponse: Response | WebSocketResponse }) => {
  const { requestId } = useParams() as { requestId: string };
  const dropdownRef = useRef<DropdownHandle>(null);
  const patchRequestMeta = useRequestMetaPatcher();
  const {
    activeEnvironment,
  } = useRouteLoaderData(':workspaceId') as WorkspaceLoaderData;
  const {
    responses,
    requestVersions,
  } = useRouteLoaderData('request/:requestId') as RequestLoaderData | WebSocketRequestLoaderData;
  const now = new Date();
  const categories: Record<string, (Response | WebSocketResponse)[]> = {
    minutes: [],
    hours: [],
    today: [],
    week: [],
    other: [],
  };

  const { organizationId, projectId, workspaceId } = useParams<{ organizationId: string; projectId: string; workspaceId: string }>();
  const fetcher = useFetcher();

  const handleSetActiveResponse = useCallback(async (requestId: string, activeResponse: Response | WebSocketResponse) => {
    if (isWebSocketResponse(activeResponse)) {
      window.main.webSocket.close({ requestId });
    }

    if (activeResponse.requestVersionId) {
      await models.requestVersion.restore(activeResponse.requestVersionId);
    }

    await patchRequestMeta(requestId, { activeResponseId: activeResponse._id });
  }, [patchRequestMeta]);

  // the response as one the request should answer (models/response-example.ts)
  const { revalidate } = useRevalidator();
  const handleSaveAsExample = useCallback(async () => {
    if (isWebSocketResponse(activeResponse)) {
      return;
    }
    await models.responseExample.create({
      parentId: requestId,
      name: `${activeResponse.statusCode} ${activeResponse.statusMessage}`.trim(),
      statusCode: activeResponse.statusCode,
      statusMessage: activeResponse.statusMessage,
      headers: activeResponse.headers.map(({ name, value }) => ({ name, value })),
      body: models.response.getBodyBuffer(activeResponse, '')?.toString() || '',
    });
    revalidate();
  }, [activeResponse, requestId, revalidate]);

  const handleDeleteResponses = useCallback(async () => {
    if (isWebSocketResponse(activeResponse)) {
      window.main.webSocket.closeAll();
    }
    fetcher.submit({}, {
      action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/debug/request/${requestId}/response/delete-all`,
      method: 'post',
      encType: 'application/json',
    });
  }, [activeResponse, fetcher, organizationId, projectId, requestId, workspaceId]);

  const handleDeleteResponse = useCallback(async () => {
    if (activeResponse) {
      if (isWebSocketResponse(activeResponse)) {
        window.main.webSocket.close({ requestId });
      }
    }
    fetcher.submit({ responseId: activeResponse._id }, {
      action: `/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/debug/request/${requestId}/response/delete`,
      method: 'post',
      encType: 'application/json',
    });
  }, [activeResponse, fetcher, requestId, organizationId, projectId, workspaceId]);

  responses.forEach((response: Response | WebSocketResponse) => {
    const responseTime = new Date(response.created);
    const match = Object.entries({
      'minutes': differenceInMinutes(now, responseTime) < 5,
      'hours': differenceInHours(now, responseTime) < 2,
      'today': isToday(responseTime),
      'week': isThisWeek(responseTime),
      'other': true,
    }).find(([, value]) => value === true)?.[0] || 'other';
    categories[match].push(response);
  });

  const renderResponseRow = (response: Response | WebSocketResponse) => {
    const activeResponseId = activeResponse ? activeResponse._id : 'n/a';
    const active = response._id === activeResponseId;
    const requestVersion = requestVersions.find(({ _id }) => _id === response.requestVersionId);
    const request = requestVersion ? decompressObject<Request | WebSocketRequest>(requestVersion.compressedRequest) : null;

    return (
      <DropdownItem
        key={response._id}
        aria-label={response._id}
      >
        <ItemContent
          isDisabled={active}
          icon={active ? 'thumb-track' : 'empty'}
          onClick={() => handleSetActiveResponse(requestId, response)}
          label={
            <>
              <StatusTag
                small
                statusCode={response.statusCode}
                statusMessage={response.statusMessage || undefined}
                tooltipDelay={1000}
              />
              <URLTag
                small
                url={request?.url || ''}
                method={request && isRequest(request) ? request.method : ''}
                tooltipDelay={1000}
              />
              <TimeTag milliseconds={response.elapsedTime} small tooltipDelay={1000} />
              {!isWebSocketResponse(response) && (
                <SizeTag
                  bytesRead={response.bytesRead}
                  bytesContent={response.bytesContent}
                  small
                  tooltipDelay={1000}
                />
              )}
              {!response.requestVersionId ?
                <i
                  className="icon fa fa-info-circle"
                  title={t('Request will not be restored with this response because it was created before this ability was added')}
                />
                : null}
            </>
          }
        />
      </DropdownItem>
    );
  };

  useDocBodyKeyboardShortcuts({
    request_toggleHistory: () => dropdownRef.current?.toggle(true),
  });

  const environmentName = activeEnvironment ? activeEnvironment.name : t('Base');
  const isLatestResponseActive = !responses.length || activeResponse._id === responses[0]._id;
  return (
    <Dropdown
      ref={dropdownRef}
      aria-label={t('Response history dropdown')}
      key={activeResponse ? activeResponse._id : 'n/a'}
      closeOnSelect={false}
      className="tall pane__header__right"
      triggerButton={
        <DropdownButton className="btn btn--super-compact tall" title={t('Response history')}>
          {activeResponse && <TimeFromNow timestamp={activeResponse.created} titleCase />}
          {!isLatestResponseActive ? (
            <i className="fa fa-thumb-tack space-left" />
          ) : (
            <i className="fa fa-caret-down space-left" />
          )}
        </DropdownButton>
      }
    >
      <DropdownSection
        aria-label={t('{environment} Responses', { environment: environmentName })}
        title={<span><strong>{environmentName}</strong> {t('Responses')}</span>}
      >
        <DropdownItem aria-label={t('Save as Example')}>
          <ItemContent
            icon="fa-bookmark-o"
            label={t('Save as Example')}
            onClick={handleSaveAsExample}
          />
        </DropdownItem>
        <DropdownItem aria-label={t('Delete Current Response')}>
          <ItemContent
            icon="fa-trash-o"
            label={t('Delete Current Response')}
            onClick={handleDeleteResponse}
          />
        </DropdownItem>
        <DropdownItem aria-label={t('Clear History')}>
          <ItemContent
            icon="fa-trash-o"
            label={t('Clear History')}
            onClick={handleDeleteResponses}
          />
        </DropdownItem>
      </DropdownSection>

      <DropdownSection
        aria-label={t('Minutes Section')}
        title={t('Just Now')}
      >
        {categories.minutes.map(renderResponseRow)}
      </DropdownSection>

      <DropdownSection
        aria-label={t('Hours Section')}
        title={t('Less Than Two Hours Ago')}
      >
        {categories.hours.map(renderResponseRow)}
      </DropdownSection>

      <DropdownSection
        aria-label={t('Today Section')}
        title={t('Today')}
      >
        {categories.today.map(renderResponseRow)}
      </DropdownSection>

      <DropdownSection
        aria-label={t('Week Section')}
        title={t('This Week')}
      >
        {categories.week.map(renderResponseRow)}
      </DropdownSection>

      <DropdownSection
        aria-label={t('Other Section')}
        title={t('Older Than This Week')}
      >
        {categories.other.map(renderResponseRow)}
      </DropdownSection>
    </Dropdown>
  );
};
