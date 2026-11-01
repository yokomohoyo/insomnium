import YAML from 'yaml';

import { Converter, ImportRequest } from '../entities';
import { scriptAsText, withInheritedScripts } from '../scripts';
import { Insomnia3Data } from './insomnia-3';

export const id = 'insomnia-4';
export const name = 'Insomnium v4';
export const description = 'Insomnium export format 4';

export interface Insomnia4Data extends Omit<Insomnia3Data, '__export_format'> {
  __export_format: 4;
}

const hasScripts = (resource: ImportRequest) => !!(resource.preRequestScript?.trim() || resource.afterResponseScript?.trim());

// Insomnia's folders have scripts too (9.3+), which run before those of each
// request under them. Insomnium's folders don't, so they're copied into the
// requests', and kept as text in the folder's description.
const withFolderScripts = (resources: ImportRequest[]) => {
  if (!resources.some(resource => resource._type === 'request_group' && hasScripts(resource))) {
    return resources;
  }
  const byId = new Map(resources.map(resource => [resource._id, resource]));
  const foldersAbove = (resource: ImportRequest) => {
    const folders: ImportRequest[] = [];
    for (let parent = byId.get(resource.parentId || undefined); parent?._type === 'request_group' && !folders.includes(parent); parent = byId.get(parent.parentId || undefined)) {
      folders.unshift(parent);
    }
    return folders;
  };
  return resources.map(resource => {
    if (resource._type === 'request_group' && hasScripts(resource)) {
      const note = 'copied into each request under this folder, which runs it';
      const blocks = ([['pre-request script', resource.preRequestScript], ['after-response script', resource.afterResponseScript]] as const)
        .flatMap(([title, code]) => code?.trim() ? [scriptAsText(`Insomnia ${title}`, note, code.trim())] : []);
      return { ...resource, description: [resource.description, ...blocks].filter(Boolean).join('\n\n') };
    }
    const folders = resource._type === 'request' ? foldersAbove(resource).filter(hasScripts) : [];
    if (!folders.length) {
      return resource;
    }
    const inherited = (code: (folder: ImportRequest) => string | undefined) =>
      folders.map(folder => ({ from: `Insomnia folder "${folder.name || ''}"`, code: code(folder) || '' }));
    const preRequestScript = withInheritedScripts(inherited(folder => folder.preRequestScript), resource.preRequestScript);
    const afterResponseScript = withInheritedScripts(inherited(folder => folder.afterResponseScript), resource.afterResponseScript);
    return {
      ...resource,
      ...(preRequestScript.trim() ? { preRequestScript } : {}),
      ...(afterResponseScript.trim() ? { afterResponseScript } : {}),
    };
  });
};

export const convert: Converter = rawData => {
  let data;

  // Not this format, without parsing it: every import tries the importers in
  // turn, and parsing a large file of another kind (a spec) took a while
  if (!rawData.includes('__export_format')) {
    return null;
  }
  try {
    data = YAML.parse(rawData);
  } catch (error) {
    return null;
  }

  if (data.__export_format !== 4) {
    // Bail early if it's not the legacy format
    return null;
  } // This is the target export format so nothing needs to change

  return Array.isArray(data.resources) ? withFolderScripts(data.resources) : data.resources;
};
