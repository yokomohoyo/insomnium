import {
  DEFAULT_PANE_HEIGHT,
  DEFAULT_PANE_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
} from '../common/constants';
import { database as db } from '../common/database';
import type { BaseModel } from './index';

export const name = 'Workspace Meta';
export const type = 'WorkspaceMeta';
export const prefix = 'wrkm';
export const canDuplicate = false;
export const canSync = false;

export interface BaseWorkspaceMeta {
  activeActivity: string | null;
  activeEnvironmentId: string | null;
  // the project's global sub environment it uses (common/global-environments.ts)
  activeGlobalEnvironmentId: string | null;
  activeRequestId: string | null;
  activeUnitTestSuiteId: string | null;
  cachedGitLastAuthor: string | null;
  cachedGitLastCommitTime: number | null;
  cachedGitRepositoryBranch: string | null;
  gitRepositoryId: string | null;
  hasSeen: boolean;
  paneHeight: number;
  paneWidth: number;
  parentId: string | null;
  sidebarFilter: string;
  sidebarHidden: boolean;
  sidebarWidth: number;
  pushSnapshotOnInitialize: boolean;
  // Per-workspace overrides for proto-fetch auth. Empty string = fall back to
  // the global Settings value. WorkspaceMeta has canSync=false so these stay
  // local and never get exported with a shared workspace.
  bufToken: string;
  githubToken: string;
  // a folder this collection is kept in step with, as readable files
  // (main/folder-sync.ts), and the documents it last had there
  syncFolderPath: string;
  folderSyncIds: string[];
  // the requests open as tabs, in order (common/open-tabs.ts)
  openRequestIds: string[];
  // a Spectral ruleset file chosen for the document's spec, on this computer
  // (common/spectral-ruleset-path.ts); empty uses its git repository's or the
  // built-in rules
  spectralRulesetPath: string;
}

export type WorkspaceMeta = BaseWorkspaceMeta & BaseModel;

export const isWorkspaceMeta = (model: Pick<BaseModel, 'type'>): model is WorkspaceMeta => (
  model.type === type
);

export function init(): BaseWorkspaceMeta {
  return {
    activeActivity: null,
    activeEnvironmentId: null,
    activeGlobalEnvironmentId: null,
    activeRequestId: null,
    activeUnitTestSuiteId: null,
    cachedGitLastAuthor: null,
    cachedGitLastCommitTime: null,
    cachedGitRepositoryBranch: null,
    gitRepositoryId: null,
    hasSeen: true,
    paneHeight: DEFAULT_PANE_HEIGHT,
    paneWidth: DEFAULT_PANE_WIDTH,
    parentId: null,
    sidebarFilter: '',
    sidebarHidden: false,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    pushSnapshotOnInitialize: false,
    bufToken: '',
    githubToken: '',
    syncFolderPath: '',
    folderSyncIds: [],
    openRequestIds: [],
    spectralRulesetPath: '',
  };
}

export function migrate(doc: WorkspaceMeta) {
  return doc;
}

export function create(patch: Partial<WorkspaceMeta> = {}) {
  if (!patch.parentId) {
    throw new Error(`New WorkspaceMeta missing parentId ${JSON.stringify(patch)}`);
  }

  return db.docCreate<WorkspaceMeta>(type, patch);
}

export function update(workspaceMeta: WorkspaceMeta, patch: Partial<WorkspaceMeta> = {}) {
  return db.docUpdate<WorkspaceMeta>(workspaceMeta, patch);
}

export async function updateByParentId(parentId: string, patch: Partial<WorkspaceMeta> = {}) {
  const meta = await getByParentId(parentId);
  // @ts-expect-error -- TSCONVERSION appears to be a genuine error not previously caught by Flow
  return db.docUpdate<WorkspaceMeta>(meta, patch);
}

export async function getByParentId(parentId: string) {
  return db.getWhere<WorkspaceMeta>(type, { parentId });
}

export async function getByGitRepositoryId(gitRepositoryId: string) {
  // @ts-expect-error -- TSCONVERSION needs generic for query
  return db.getWhere<WorkspaceMeta>(type, { gitRepositoryId });
}

export async function getOrCreateByParentId(parentId: string, patch: any = {}) {
  const doc = await getByParentId(parentId);
  return doc || create({ ...patch, parentId },);
}

export function all() {
  return db.all<WorkspaceMeta>(type);
}
