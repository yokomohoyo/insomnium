// Kong Insomnia's Git projects (12.6 and later): a repository whose collections
// and documents are each a v5 YAML file, anywhere in it, rather than a data
// folder (.insomnia or .insomnium). Insomnium's Git Sync keeps one collection
// to a repository, in its data folder, so a clone of one of these imports each
// file as a collection or document of its own, unlinked: linking them would
// write a data folder into a repository laid out for another app.
import type { PromiseFsClient } from 'isomorphic-git';
import path from 'path';

import { importResourcesToProject } from '../../common/importResourcesToProject';
import { scanResources } from '../../common/import';
import * as models from '../../models';
import { isWorkspace, type Workspace } from '../../models/workspace';
import { GIT_CLONE_DIR } from './git-vcs';

// a collection's or a document's file (environment files are a project's
// global environments in Kong, which Insomnium keeps otherwise)
const V5_FILE = /^type:\s*["']?(?:collection|spec)\.insomnia\.rest\/5\.0["']?\s*$/m;
export const isInsomniaV5File = (text: string) => V5_FILE.test(text);

export interface ProjectFile {
  path: string;
  content: string;
}

// The repository's v5 files: YAML, not in a dot folder or node_modules, not
// through a link, and within limits, as a repository can hold anything
export async function findInsomniaProjectFiles(
  fsClient: PromiseFsClient,
  { maxFiles = 100, maxDepth = 6, maxBytes = 10 * 1024 * 1024 } = {},
): Promise<ProjectFile[]> {
  const found: ProjectFile[] = [];
  const walk = async (dir: string, depth: number) => {
    const names: string[] = [...await fsClient.promises.readdir(dir)].sort();
    for (const name of names) {
      if (found.length >= maxFiles) {
        return;
      }
      if (name.startsWith('.') || name === 'node_modules') {
        continue;
      }
      const file = path.join(dir, name);
      const stat = await fsClient.promises.lstat(file);
      if (stat.isSymbolicLink?.()) {
        continue;
      }
      if (stat.isDirectory()) {
        if (depth < maxDepth) {
          await walk(file, depth + 1);
        }
      } else if (/\.ya?ml$/i.test(name) && stat.size <= maxBytes) {
        const content = (await fsClient.promises.readFile(file)).toString();
        if (isInsomniaV5File(content)) {
          found.push({ path: path.relative(GIT_CLONE_DIR, file).split(path.sep).join('/'), content });
        }
      }
    }
  };
  await walk(GIT_CLONE_DIR, 0);
  return found;
}

// Imports each file into the project, one at a time (an import scans into a
// shared cache). Returns the new collections and documents, and the files that
// didn't import, with why.
export async function importInsomniaProjectFiles(files: ProjectFile[], projectId: string) {
  const before = new Set((await models.workspace.findByParentId(projectId)).map(({ _id }) => _id));
  const failed: { path: string; error: string }[] = [];
  for (const file of files) {
    const scanned = await scanResources({ content: file.content });
    if (scanned.errors?.length || scanned.type?.id !== 'insomnia-5') {
      failed.push({ path: file.path, error: scanned.errors?.join('; ') || 'not an Insomnia v5 file' });
      continue;
    }
    try {
      await importResourcesToProject({ projectId });
    } catch (err) {
      failed.push({ path: file.path, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const workspaces: Workspace[] = (await models.workspace.findByParentId(projectId)).filter(workspace => isWorkspace(workspace) && !before.has(workspace._id));
  return { workspaces, failed };
}
