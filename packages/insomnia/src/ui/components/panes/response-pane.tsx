import { text } from 'node:stream/consumers';

import { extension as mimeExtension } from 'mime-types';
import React, { type FC, useCallback, useMemo, useState } from 'react';
import { useFetcher, useParams, useRouteLoaderData } from 'react-router-dom';

import { PREVIEW_MODE_SOURCE } from '../../../common/constants';
import { t } from '../../../common/i18n';
import { getSetCookieHeaders } from '../../../common/misc';
import { worstSeverity } from '../../../common/response-audit';
import { ignoredRules, withoutIgnored } from '../../../common/security-rules';
import { notInSpecFinding, requestAgainstSpec } from '../../../common/spec-inventory';
import { writeToFile } from '../../../common/write-to-file';
import * as models from '../../../models';
import { cancelRequestById } from '../../../network/cancellation';
import { jsonPrettify } from '../../../utils/prettify/json';
import { useRequestMetaPatcher } from '../../hooks/use-request';
import { projectPath } from '../../routes/paths';
import type { RequestLoaderData } from '../../routes/request';
import type { RootLoaderData } from '../../routes/root';
import type { WorkspaceLoaderData } from '../../routes/workspace';
import { restrictedIds } from '../../utils/restricted';
import { PanelContainer, TabItem, Tabs } from '../base/tabs';
import { PreviewModeDropdown } from '../dropdowns/preview-mode-dropdown';
import { ResponseHistoryDropdown } from '../dropdowns/response-history-dropdown';
import { ErrorBoundary } from '../error-boundary';
import { showError } from '../modals';
import { ResponseTimer } from '../response-timer';
import { SizeTag } from '../tags/size-tag';
import { StatusTag } from '../tags/status-tag';
import { TimeTag } from '../tags/time-tag';
import { AssertionResultsViewer } from '../viewers/assertion-results-viewer';
import { ResponseCookiesViewer } from '../viewers/response-cookies-viewer';
import { ResponseHeadersViewer } from '../viewers/response-headers-viewer';
import { IgnoredSecurityRules, ResponseSecurityViewer, SpecSecurityNote, useResponseAudit } from '../viewers/response-security-viewer';
import { ResponseTimelineViewer } from '../viewers/response-timeline-viewer';
import { ResponseViewer } from '../viewers/response-viewer';
import { ResponseVisualizer } from '../viewers/response-visualizer';
import { securityTestFindings, SecurityTestsPanel } from '../viewers/security-tests-panel';
import { BlankPane } from './blank-pane';
import { Pane, PaneHeader } from './pane';
import { PlaceholderResponsePane } from './placeholder-response-pane';

interface Props {
  runningRequests: Record<string, boolean>;
}
export const ResponsePane: FC<Props> = ({
  runningRequests,
}) => {
  const { activeRequest, activeRequestMeta, activeResponse } = useRouteLoaderData('request/:requestId') as RequestLoaderData;
  const filterHistory = activeRequestMeta.responseFilterHistory || [];
  const filter = activeRequestMeta.responseFilter || '';
  const patchRequestMeta = useRequestMetaPatcher();
  const {
    settings,
  } = useRouteLoaderData('root') as RootLoaderData;
  const previewMode = activeRequestMeta.previewMode || PREVIEW_MODE_SOURCE;
  const { activeEnvironment, subEnvironments, activeWorkspace, activeApiSpec, collection } = useRouteLoaderData(':workspaceId') as WorkspaceLoaderData;
  // marked as for some users only, itself or by a folder it's in
  const requestIsRestricted = Boolean(activeRequest && restrictedIds(collection || []).has(activeRequest._id));
  // the Security tab's rules this collection ignores: the collection's own, so
  // its exports and its team have them
  const ignoredSecurityRules = ignoredRules(activeWorkspace?.securityIgnoredRules);
  const { organizationId, projectId, workspaceId } = useParams() as { organizationId: string; projectId: string; workspaceId: string };
  const ignoredFetcher = useFetcher();
  const setIgnoredSecurityRules = (securityIgnoredRules: string[]) => ignoredFetcher.submit(
    { workspaceId, securityIgnoredRules },
    { action: projectPath({ organizationId, projectId }, 'workspace/update'), method: 'post', encType: 'application/json' },
  );
  // a design document's request against its spec, as Security Checks does
  // for the whole document: nothing is sent to tell
  const specContents = activeWorkspace?.scope === 'design' ? activeApiSpec?.contents : undefined;
  const requestMethod = activeRequest?.method;
  const requestUrl = activeRequest?.url;
  const againstSpec = useMemo(
    () => specContents && requestMethod !== undefined && requestUrl ? requestAgainstSpec(specContents, { method: requestMethod, url: requestUrl }) : null,
    [specContents, requestMethod, requestUrl],
  );
  const specFindings = againstSpec && !againstSpec.described.length ? withoutIgnored([notInSpecFinding(againstSpec.operation)], ignoredSecurityRules) : [];
  const audited = useResponseAudit(activeResponse);
  const securityFindings = audited && withoutIgnored(audited, ignoredSecurityRules);
  // (what the tests found is the panel's: this redraws the tab's count after a run)
  const [, countAgain] = useState(0);
  const testFindings = activeRequest ? withoutIgnored(securityTestFindings(activeRequest), ignoredSecurityRules) : [];
  const handleSetFilter = async (responseFilter: string) => {
    if (!activeResponse) {
      return;
    }
    const requestId = activeResponse.parentId;
    await patchRequestMeta(requestId, { responseFilter });
    const meta = await models.requestMeta.getByParentId(requestId);
    if (!meta) {
      return;
    }
    const responseFilterHistory = meta.responseFilterHistory.slice(0, 10);
    // Already in history or empty?
    if (!responseFilter || responseFilterHistory.includes(responseFilter)) {
      return;
    }
    responseFilterHistory.unshift(responseFilter);
    patchRequestMeta(requestId, { responseFilterHistory });
  };
  const handleGetResponseBody = useCallback(() => {
    if (!activeResponse) {
      return null;
    }
    return models.response.getBodyBuffer(activeResponse);
  }, [activeResponse]);
  const handleCopyResponseToClipboard = useCallback(async () => {
    const bodyBuffer = handleGetResponseBody();
    if (bodyBuffer) {
      window.clipboard.writeText(bodyBuffer.toString('utf8'));
    }
  }, [handleGetResponseBody]);
  const handleDownloadResponseBody = useCallback(async (prettify: boolean) => {
    if (!activeResponse || !activeRequest) {
      console.warn('Nothing to download');
      return;
    }

    const { contentType } = activeResponse;
    const extension = mimeExtension(contentType) || 'unknown';
    const { canceled, filePath: outputPath } = await window.dialog.showSaveDialog({
      title: t('Save Response Body'),
      buttonLabel: t('Save'),
      defaultPath: `${activeRequest.name.replace(/ +/g, '_')}-${Date.now()}.${extension}`,
    });

    if (canceled || !outputPath) {
      return;
    }

    const body = models.response.getBodyStream(activeResponse);
    let error: Error | null;
    if (!body || typeof body === 'string') {
      error = new Error(t('the response body could not be read'));
    } else if (prettify && contentType.includes('json')) {
      // Prettifying needs the whole body in memory
      error = await text(body).then(
        json => writeToFile(outputPath, jsonPrettify(json)),
        (err: Error) => err,
      );
    } else {
      error = await writeToFile(outputPath, body);
    }
    if (error) {
      showError({
        title: t('Save Failed'),
        message: t('Failed to save to {path}: {error}', { path: outputPath, error: error.message }),
        error,
      });
    }
  }, [activeRequest, activeResponse]);

  if (!activeRequest) {
    return <BlankPane type="response" />;
  }

  // If there is no previous response, show placeholder for loading indicator
  if (!activeResponse) {
    return (
      <PlaceholderResponsePane>
        {runningRequests[activeRequest._id] && <ResponseTimer
          handleCancel={() => cancelRequestById(activeRequest._id)}
        />}
      </PlaceholderResponsePane>
    );
  }
  const timeline = models.response.getTimeline(activeResponse);
  const cookieHeaders = getSetCookieHeaders(activeResponse.headers);
  const assertionResults = activeResponse.assertionResults || [];
  const countedFindings = [...securityFindings || [], ...specFindings, ...testFindings];
  const worstFinding = worstSeverity(countedFindings);
  return (
    <Pane type="response">
      {!activeResponse ? null : (
        <PaneHeader className="row-spaced">
          <div aria-atomic="true" aria-live="polite" className="no-wrap scrollable scrollable--no-bars pad-left">
            <StatusTag statusCode={activeResponse.statusCode} statusMessage={activeResponse.statusMessage} />
            <TimeTag milliseconds={activeResponse.elapsedTime} timings={activeResponse.timings} />
            <SizeTag bytesRead={activeResponse.bytesRead} bytesContent={activeResponse.bytesContent} />
          </div>
          <ResponseHistoryDropdown
            activeResponse={activeResponse}
          />
        </PaneHeader>
      )}
      <Tabs
        aria-label={t('Response pane tabs')}
      >
        {[
        <TabItem
          key="preview"
          title={
            <PreviewModeDropdown
              download={handleDownloadResponseBody}
              copyToClipboard={handleCopyResponseToClipboard}
            />
          }
        >
          <ResponseViewer
            key={activeResponse._id}
            bytes={Math.max(activeResponse.bytesContent, activeResponse.bytesRead)}
            contentType={activeResponse.contentType || ''}
            disableHtmlPreviewJs={settings.disableHtmlPreviewJs}
            disablePreviewLinks={settings.disableResponsePreviewLinks}
            download={handleDownloadResponseBody}
            editorFontSize={settings.editorFontSize}
            error={activeResponse.error}
            filter={filter}
            filterHistory={filterHistory}
            getBody={handleGetResponseBody}
            previewMode={activeResponse.error ? PREVIEW_MODE_SOURCE : previewMode}
            responseId={activeResponse._id}
            updateFilter={activeResponse.error ? undefined : handleSetFilter}
            url={activeResponse.url}
          />
        </TabItem>,
        <TabItem
          key="headers"
          title={
            <>
              {t('Headers')}
              {activeResponse.headers.length > 0 && (
                <span className="bubble">{activeResponse.headers.length}</span>
              )}
            </>
          }
        >
          <PanelContainer className="pad">
            <ErrorBoundary key={activeResponse._id} errorClassName="font-error pad text-center">
              <ResponseHeadersViewer headers={activeResponse.headers} />
            </ErrorBoundary>
          </PanelContainer>
        </TabItem>,
        <TabItem
          key="cookies"
          title={
            <>
              {t('Cookies')}
              {cookieHeaders.length ? (
                <span className="bubble">{cookieHeaders.length}</span>
              ) : null}
            </>
          }
        >
          <PanelContainer className="pad">
            <ErrorBoundary key={activeResponse._id} errorClassName="font-error pad text-center">
              <ResponseCookiesViewer
                cookiesSent={activeResponse.settingSendCookies}
                cookiesStored={activeResponse.settingStoreCookies}
                headers={cookieHeaders}
              />
            </ErrorBoundary>
          </PanelContainer>
        </TabItem>,
        <TabItem
          key="tests"
          title={
            <>
              {t('Tests')}
              {assertionResults.length > 0 && (
                <span className={`bubble ${assertionResults.every(result => result.passed) ? 'success' : 'danger'}`}>
                  {assertionResults.filter(result => result.passed).length}/{assertionResults.length}
                </span>
              )}
            </>
          }
        >
          <PanelContainer className="pad">
            <ErrorBoundary key={activeResponse._id} errorClassName="font-error pad text-center">
              <AssertionResultsViewer results={assertionResults} logs={activeResponse.scriptLogs} />
            </ErrorBoundary>
          </PanelContainer>
        </TabItem>,
        // only for a response a script visualized
        ...(activeResponse.visualization ? [
          <TabItem key="visualize" title={t('Visualize')}>
            <ErrorBoundary key={activeResponse._id} errorClassName="font-error pad text-center">
              <ResponseVisualizer visualization={activeResponse.visualization} />
            </ErrorBoundary>
          </TabItem>,
        ] : []),
        <TabItem
          key="security"
          title={
            <>
              {t('Security')}
              {countedFindings.length ? (
                <span className={`bubble ${worstFinding === 'high' ? 'danger' : worstFinding === 'medium' ? 'warning' : ''}`}>{countedFindings.length}</span>
              ) : null}
            </>
          }
        >
          <PanelContainer className="pad">
            <ErrorBoundary key={activeResponse._id} errorClassName="font-error pad text-center">
              <ResponseSecurityViewer
                findings={securityFindings}
                noResponse={Boolean(activeResponse.error) || !activeResponse.statusCode}
                onIgnore={id => setIgnoredSecurityRules([...ignoredSecurityRules, id])}
              />
            </ErrorBoundary>
            <ErrorBoundary errorClassName="font-error pad text-center">
              {againstSpec ? (
                <SpecSecurityNote
                  described={againstSpec.described}
                  finding={specFindings[0]}
                  onIgnore={id => setIgnoredSecurityRules([...ignoredSecurityRules, id])}
                />
              ) : null}
              <SecurityTestsPanel
                request={activeRequest}
                environments={subEnvironments.filter(({ _id }) => _id !== activeEnvironment._id)}
                ignored={ignoredSecurityRules}
                restricted={requestIsRestricted}
                onIgnore={id => setIgnoredSecurityRules([...ignoredSecurityRules, id])}
                onResult={() => countAgain(count => count + 1)}
              />
              <IgnoredSecurityRules ignored={ignoredSecurityRules} onRestore={id => setIgnoredSecurityRules(ignoredSecurityRules.filter(rule => rule !== id))} />
            </ErrorBoundary>
          </PanelContainer>
        </TabItem>,
        <TabItem key="timeline" title={t('Timeline')}>
          <ErrorBoundary key={activeResponse._id} errorClassName="font-error pad text-center">
            <ResponseTimelineViewer
              key={activeResponse._id}
              timeline={timeline}
            />
          </ErrorBoundary>
        </TabItem>,
        ]}
      </Tabs>
      <ErrorBoundary errorClassName="font-error pad text-center">
        {runningRequests[activeRequest._id] && <ResponseTimer
          handleCancel={() => cancelRequestById(activeRequest._id)}
        />}
      </ErrorBoundary>
    </Pane>
  );
};
