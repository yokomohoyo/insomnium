import * as models from '../models';
import type { Workspace } from '../models/workspace';
import type { WorkspaceMeta } from '../models/workspace-meta';
import { ignoredRules } from './security-rules';

// 0.10 and 0.11 kept the Security tab's ignored rules with the collection's
// settings on this computer (WorkspaceMeta). They are the collection's own now
// (Workspace), where its exports and its team get them: what was kept here is
// added to those, once, as the collection is opened.
export async function moveIgnoredSecurityRules(workspace: Workspace, meta: WorkspaceMeta) {
  const kept = ignoredRules(meta.securityIgnoredRules);
  if (!kept.length) {
    return { workspace, meta };
  }
  return {
    workspace: await models.workspace.update(workspace, { securityIgnoredRules: ignoredRules([...workspace.securityIgnoredRules || [], ...kept]) }),
    meta: await models.workspaceMeta.updateByParentId(workspace._id, { securityIgnoredRules: [] }),
  };
}
