// Import
import fs from 'fs';
import { ActionFunction } from 'react-router-dom';

import { fetchImportContentFromURI, scanResources, ScanResult } from '../../common/import';
import { guard } from '../../utils/guard';

export interface ScanForResourcesActionResult extends ScanResult { }

// Windows tools often save with a byte order mark (Notepad and PowerShell 5.1
// write UTF-8 with a BOM, and PowerShell's `>` writes UTF-16LE). Decode those
// and drop the mark, as fetch's response.text() does for the uri branch, so
// JSON-based importers can parse the content.
const decodeFileContent = (buffer: Buffer) => {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le', 2);
  }
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf8', 3);
  }
  return buffer.toString('utf8');
};

const errorMessage = (err: unknown) => err instanceof Error ? err.message : String(err);

export const scanForResourcesAction: ActionFunction = async ({ request }): Promise<ScanForResourcesActionResult> => {
  const formData = await request.formData();

  const source = formData.get('importFrom');
  guard(typeof source === 'string', 'Source is required.');
  guard(['file', 'uri', 'clipboard'].includes(source), 'Unsupported import type');

  let content = '';
  if (source === 'uri') {
    const uri = formData.get('uri');
    if (typeof uri !== 'string' || uri === '') {
      return {
        errors: ['URI is required'],
      };
    }

    try {
      content = await fetchImportContentFromURI({
        uri,
      });
    } catch (err) {
      return {
        errors: [errorMessage(err)],
      };
    }
  } else if (source === 'file') {
    const filePath = formData.get('filePath');
    if (typeof filePath !== 'string' || filePath === '') {
      return {
        errors: ['File is required'],
      };
    }
    // filePath only comes from the file the user picked or dropped in the
    // Import modal (webUtils.getPathForFile), never from a deep link, so read
    // it directly. Going through fetchImportContentFromURI would hit its
    // file:// block, which exists for untrusted `uri` input.
    try {
      content = decodeFileContent(await fs.promises.readFile(filePath));
    } catch (err) {
      return {
        errors: [errorMessage(err)],
      };
    }
  } else {
    content = window.clipboard.readText();
  }

  if (!content) {
    return {
      errors: ['No content to import'],
    };
  }

  const result = await scanResources({ content });

  return result;
};

export interface ImportResourcesActionResult {
  errors?: string[];
  done: boolean;
}
