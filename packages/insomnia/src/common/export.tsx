import { format } from 'date-fns';
import fs from 'fs';
import path from 'path';
import React from 'react';

import * as requestOperations from '../models/helpers/request-operations';
import type { BaseModel } from '../models/index';
import * as models from '../models/index';
import { isWorkspace, Workspace } from '../models/workspace';
import { showAlert, showError, showModal } from '../ui/components/modals';
import { AskModal } from '../ui/components/modals/ask-modal';
import { SelectModal } from '../ui/components/modals/select-modal';
import { database } from './database';
import { exportRequestsData, exportRequestsHAR, exportWorkspacesData, exportWorkspacesHAR } from './export-data';
import { toOpenApiYaml } from './export-openapi';
import { clientFromExport } from './openapi-client';
import { toPostmanCollection } from './export-postman';
import { strings } from './strings';

// the data itself is in export-data.ts, which the main process can import
export * from './export-data';

const VALUE_JSON = 'json';
const VALUE_YAML = 'yaml';
const VALUE_HAR = 'har';
const VALUE_POSTMAN = 'postman';
const VALUE_OPENAPI = 'openapi';
const VALUE_TYPESCRIPT = 'typescript';

export type SelectedFormat =
  | typeof VALUE_HAR
  | typeof VALUE_JSON
  | typeof VALUE_YAML
  | typeof VALUE_POSTMAN
  | typeof VALUE_OPENAPI
  | typeof VALUE_TYPESCRIPT
  ;

// Insomnium's export, as a Postman collection (export-postman.ts)
const asPostman = (insomniumJson: string, name: string) => JSON.stringify(toPostmanCollection(JSON.parse(insomniumJson).resources, name), null, 2);

// and as an OpenAPI description of its HTTP requests (export-openapi.ts)
const asOpenApi = (insomniumJson: string, name: string) => toOpenApiYaml(JSON.parse(insomniumJson).resources, name);

// and as a TypeScript client for the API (openapi-client.ts)
const asTypeScriptClient = (insomniumJson: string, name: string) => clientFromExport(JSON.parse(insomniumJson).resources, name);

const EXTENSIONS: Record<string, string> = { [VALUE_POSTMAN]: 'postman_collection.json', [VALUE_OPENAPI]: 'openapi.yaml', [VALUE_TYPESCRIPT]: 'client.ts' };

const showSelectExportTypeModal = ({ onDone }: {
  onDone: (selectedFormat: SelectedFormat) => Promise<void>;
}) => {
  const options = [
    {
      name: 'Insomnium v4 (JSON)',
      value: VALUE_JSON,
    },
    {
      name: 'Insomnium v4 (YAML)',
      value: VALUE_YAML,
    },
    {
      name: 'HAR – HTTP Archive Format',
      value: VALUE_HAR,
    },
    {
      name: 'Postman Collection v2.1',
      value: VALUE_POSTMAN,
    },
    {
      name: 'OpenAPI 3.0 (YAML)',
      value: VALUE_OPENAPI,
    },
    {
      name: 'TypeScript client (from OpenAPI)',
      value: VALUE_TYPESCRIPT,
    },
  ];

  const lastFormat = window.localStorage.getItem('insomnia.lastExportFormat');
  const defaultValue = options.find(({ value }) => value === lastFormat) ? lastFormat : VALUE_JSON;

  showModal(SelectModal, {
    title: 'Select Export Type',
    value: defaultValue,
    options,
    message: 'Which format would you like to export as?',
    onDone: async selectedFormat => {
      if (selectedFormat) {
        window.localStorage.setItem('insomnia.lastExportFormat', selectedFormat);
        await onDone(selectedFormat as SelectedFormat);
      }
    },
  });
};

const showExportPrivateEnvironmentsModal = async () => {
  return new Promise<boolean>(resolve => {
    showModal(AskModal, {
      title: 'Export Private Environments?',
      message: 'Do you want to include private environments in your export?',
      onDone: async (isYes: boolean) => {
        if (isYes) {
          resolve(true);
        } else {
          resolve(false);
        }
      },
    });
  });
};

const showSaveExportedFileDialog = async ({
  exportedFileNamePrefix,
  selectedFormat,
}: {
  exportedFileNamePrefix: string;
  selectedFormat: SelectedFormat;
}) => {
  const date = format(Date.now(), 'yyyy-MM-dd');
  const name = exportedFileNamePrefix.replace(/ /g, '-');
  const lastDir = window.localStorage.getItem('insomnia.lastExportPath');
  const dir = lastDir || window.app.getPath('desktop');
  const options = {
    title: 'Export Insomnium Data',
    buttonLabel: 'Export',
    defaultPath: `${path.join(dir, `${name}_${date}`)}.${EXTENSIONS[selectedFormat] || selectedFormat}`,
  };
  const { filePath } = await window.dialog.showSaveDialog(options);
  return filePath || null;
};

const writeExportedFileToFileSystem = (filename: string, jsonData: string, onDone: fs.NoParamCallback) => {
  // Remember last exported path
  window.localStorage.setItem('insomnia.lastExportPath', path.dirname(filename));
  fs.writeFile(filename, jsonData, {}, onDone);
};

export const exportAllToFile = (activeProjectName: string, workspacesForActiveProject: Workspace[]) => {
  if (!workspacesForActiveProject.length) {
    showAlert({
      title: 'Cannot export',
      message: <>There are no workspaces to export in the <strong>{activeProjectName}</strong> {strings.project.singular.toLowerCase()}.</>,
    });
    return;
  }

  showSelectExportTypeModal({
    onDone: async selectedFormat => {
      const exportPrivateEnvironments = await showExportPrivateEnvironmentsModal();
      const fileName = await showSaveExportedFileDialog({
        exportedFileNamePrefix: activeProjectName,
        selectedFormat,
      });

      if (!fileName) {
        return;
      }

      let stringifiedExport;

      try {
        switch (selectedFormat) {
          case VALUE_HAR:
            stringifiedExport = await exportWorkspacesHAR(workspacesForActiveProject, exportPrivateEnvironments);
            break;

          case VALUE_YAML:
            stringifiedExport = await exportWorkspacesData(workspacesForActiveProject, exportPrivateEnvironments, 'yaml');
            break;

          case VALUE_JSON:
            stringifiedExport = await exportWorkspacesData(workspacesForActiveProject, exportPrivateEnvironments, 'json');
            break;

          case VALUE_POSTMAN:
            stringifiedExport = asPostman(await exportWorkspacesData(workspacesForActiveProject, exportPrivateEnvironments, 'json'), activeProjectName);
            break;

          case VALUE_OPENAPI:
            stringifiedExport = asOpenApi(await exportWorkspacesData(workspacesForActiveProject, exportPrivateEnvironments, 'json'), activeProjectName);
            break;

          case VALUE_TYPESCRIPT:
            stringifiedExport = asTypeScriptClient(await exportWorkspacesData(workspacesForActiveProject, exportPrivateEnvironments, 'json'), activeProjectName);
            break;

          default:
            throw new Error(`selected export format "${selectedFormat}" is invalid`);
        }

      } catch (err) {
        showError({
          title: 'Export Failed',
          error: err,
          message: 'Export failed due to an unexpected error',
        });
        return;
      }

      writeExportedFileToFileSystem(fileName, stringifiedExport, err => {
        if (err) {
          console.warn('Export failed', err);
        }
      });
    },
  });
};
export const exportRequestsToFile = (requestIds: string[]) => {
  showSelectExportTypeModal({
    onDone: async selectedFormat => {
      const requests: BaseModel[] = [];
      const workspaceLookup: any = {};
      for (const requestId of requestIds) {
        const request = await requestOperations.getById(requestId);

        if (request == null) {
          continue;
        }

        requests.push(request);
        const ancestors = await database.withAncestors(request, [
          models.workspace.type,
          models.requestGroup.type,
        ]);
        const workspace = ancestors.find(isWorkspace);

        if (workspace == null || workspaceLookup.hasOwnProperty(workspace._id)) {
          continue;
        }

        workspaceLookup[workspace._id] = true;
      }
      const exportPrivateEnvironments = await showExportPrivateEnvironmentsModal();
      const fileName = await showSaveExportedFileDialog({
        exportedFileNamePrefix: 'Insomnium',
        selectedFormat,
      });

      if (!fileName) {
        return;
      }

      let stringifiedExport;

      try {
        switch (selectedFormat) {
          case VALUE_HAR:
            stringifiedExport = await exportRequestsHAR(requests, exportPrivateEnvironments);
            break;

          case VALUE_YAML:
            stringifiedExport = await exportRequestsData(requests, exportPrivateEnvironments, 'yaml');
            break;

          case VALUE_JSON:
            stringifiedExport = await exportRequestsData(requests, exportPrivateEnvironments, 'json');
            break;

          case VALUE_POSTMAN:
            stringifiedExport = asPostman(await exportRequestsData(requests, exportPrivateEnvironments, 'json'), 'Insomnium');
            break;

          case VALUE_OPENAPI:
            stringifiedExport = asOpenApi(await exportRequestsData(requests, exportPrivateEnvironments, 'json'), 'Insomnium');
            break;

          case VALUE_TYPESCRIPT:
            stringifiedExport = asTypeScriptClient(await exportRequestsData(requests, exportPrivateEnvironments, 'json'), 'Insomnium');
            break;

          default:
            throw new Error(`selected export format "${selectedFormat}" is invalid`);
        }

      } catch (err) {
        showError({
          title: 'Export Failed',
          error: err,
          message: 'Export failed due to an unexpected error',
        });
        return;
      }

      writeExportedFileToFileSystem(fileName, stringifiedExport, err => {
        if (err) {
          console.warn('Export failed', err);
        }
      });
    },
  });
};
