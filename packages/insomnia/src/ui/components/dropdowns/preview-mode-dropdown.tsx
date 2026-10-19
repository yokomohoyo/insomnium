import React, { FC, useCallback } from 'react';
import { useRouteLoaderData } from 'react-router-dom';

import { getPreviewModeName, PREVIEW_MODE_SOURCE, PREVIEW_MODES } from '../../../common/constants';
import { exportHarCurrentRequest } from '../../../common/har';
import { t } from '../../../common/i18n';
import { writeToFile } from '../../../common/write-to-file';
import * as models from '../../../models';
import { isRequest } from '../../../models/request';
import { isResponse } from '../../../models/response';
import { useRequestMetaPatcher } from '../../hooks/use-request';
import { RequestLoaderData } from '../../routes/request';
import { Dropdown, DropdownButton, DropdownItem, DropdownSection, ItemContent } from '../base/dropdown';
import { showError } from '../modals';

interface Props {
  download: (pretty: boolean) => any;
  copyToClipboard: () => any;
}

export const PreviewModeDropdown: FC<Props> = ({
  download,
  copyToClipboard,
}) => {
  const { activeRequest, activeRequestMeta, activeResponse } = useRouteLoaderData('request/:requestId') as RequestLoaderData;
  const previewMode = activeRequestMeta.previewMode || PREVIEW_MODE_SOURCE;
  const patchRequestMeta = useRequestMetaPatcher();
  const handleDownloadPrettify = useCallback(() => download(true), [download]);

  const handleDownloadNormal = useCallback(() => download(false), [download]);

  const exportAsHAR = useCallback(async () => {
    if (!activeResponse || !activeRequest || !isRequest(activeRequest) || !isResponse(activeResponse)) {
      console.warn('Nothing to download');
      return;
    }

    let har: string;
    try {
      // Fails when, for example, the request cannot be rendered
      har = JSON.stringify(await exportHarCurrentRequest(activeRequest, activeResponse), null, '\t');
    } catch (err) {
      showError({
        title: t('Export Failed'),
        message: t('Failed to export as HAR: {error}', { error: err.message }),
        error: err,
      });
      return;
    }

    const { filePath } = await window.dialog.showSaveDialog({
      title: t('Export As HAR'),
      buttonLabel: t('Save'),
      defaultPath: `${activeRequest.name.replace(/ +/g, '_')}-${Date.now()}.har`,
    });

    if (!filePath) {
      return;
    }
    const error = await writeToFile(filePath, har);
    if (error) {
      showError({
        title: t('Save Failed'),
        message: t('Failed to save to {path}: {error}', { path: filePath, error: error.message }),
        error,
      });
    }
  }, [activeRequest, activeResponse]);

  const exportDebugFile = useCallback(async () => {
    if (!activeResponse || !activeRequest || !isResponse(activeResponse)) {
      console.warn('Nothing to download');
      return;
    }

    const timeline = models.response.getTimeline(activeResponse);
    const headers = timeline
      .filter(v => v.name === 'HeaderIn')
      .map(v => v.value)
      .join('');

    const { canceled, filePath } = await window.dialog.showSaveDialog({
      title: t('Save Full Response'),
      buttonLabel: t('Save'),
      defaultPath: `${activeRequest.name.replace(/ +/g, '_')}-${Date.now()}.txt`,
    });

    if (canceled || !filePath) {
      return;
    }
    const readStream = models.response.getBodyStream(activeResponse);
    const error = readStream && typeof readStream !== 'string'
      ? await writeToFile(filePath, headers, readStream)
      : new Error(t('the response body could not be read'));
    if (error) {
      showError({
        title: t('Save Failed'),
        message: t('Failed to save to {path}: {error}', { path: filePath, error: error.message }),
        error,
      });
    }
  }, [activeRequest, activeResponse]);
  const shouldPrettifyOption = activeResponse?.contentType.includes('json');

  return (
    <Dropdown
      aria-label={t('Preview Mode Dropdown')}
      triggerButton={
        <DropdownButton className="tall">
          {getPreviewModeName(previewMode)}
          <i className="fa fa-caret-down space-left" />
        </DropdownButton>
      }
    >
      <DropdownSection
        aria-label={t('Preview Mode Section')}
        title={t('Preview Mode')}
      >
        {PREVIEW_MODES.map(mode =>
          <DropdownItem
            key={mode}
            aria-label={getPreviewModeName(mode, true)}
          >
            <ItemContent
              icon={previewMode === mode ? 'check' : 'empty'}
              label={getPreviewModeName(mode, true)}
              onClick={() => patchRequestMeta(activeRequest._id, { previewMode: mode })}
            />
          </DropdownItem>
        )}
      </DropdownSection>
      <DropdownSection
        aria-label={t('Action Section')}
        title={t('Action')}
      >
        <DropdownItem aria-label={t('Copy raw response')}>
          <ItemContent
            icon="copy"
            label={t('Copy raw response')}
            onClick={copyToClipboard}
          />
        </DropdownItem>
        <DropdownItem aria-label={t('Export raw response')}>
          <ItemContent
            icon="save"
            label={t('Export raw response')}
            onClick={handleDownloadNormal}
          />
        </DropdownItem>
        <DropdownItem aria-label={t('Export prettified response')}>
          {shouldPrettifyOption &&
            <ItemContent
              icon="save"
              label={t('Export prettified response')}
              onClick={handleDownloadPrettify}
            />
          }
        </DropdownItem>
        <DropdownItem aria-label={t('Export HTTP debug')}>
          <ItemContent
            icon="bug"
            label={t('Export HTTP debug')}
            onClick={exportDebugFile}
          />
        </DropdownItem>
        <DropdownItem aria-label={t('Export as HAR')}>
          <ItemContent
            icon="save"
            label={t('Export as HAR')}
            onClick={exportAsHAR}
          />
        </DropdownItem>
      </DropdownSection>
    </Dropdown>
  );
};
