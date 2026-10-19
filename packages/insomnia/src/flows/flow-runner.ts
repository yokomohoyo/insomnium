// The app's side of a flow's run: a request is sent as the collection runner
// sends one (its scripts, assertions and cookies, and its response stored),
// with the flow's variables over the environment's, as the runner's data rows
// are; and a variable's value is rendered in the workspace's environment.
import { t } from '../common/i18n';
import { getRenderContext, getRenderContextAncestors, render, RENDER_PURPOSE_SEND } from '../common/render';
import * as models from '../models';
import { sendForRun } from '../network/runner';
import type { FlowRunner } from './run-flow';

export const appFlowRunner = ({ workspaceId, environmentId }: { workspaceId: string; environmentId?: string }): FlowRunner => ({
  async send(requestId, variables, signal) {
    const request = await models.request.getById(requestId);
    // one of this workspace's: a flow copied without its requests keeps the old ids
    const workspace = request && (await getRenderContextAncestors(request)).find(models.workspace.isWorkspace);
    if (!request || workspace?._id !== workspaceId) {
      throw new Error(t('The request it sends is no longer in this collection: choose another.'));
    }
    const { stored, url } = await sendForRun(request, { environmentId, iterationData: variables });
    if (signal.aborted) {
      throw new Error(t('Stopped'));
    }
    if (stored.error) {
      throw new Error(stored.error);
    }
    return {
      statusCode: stored.statusCode,
      statusMessage: stored.statusMessage,
      headers: stored.headers,
      elapsedTime: stored.elapsedTime,
      body: String(models.response.getBodyBuffer(stored) ?? ''),
      method: request.method,
      url,
    };
  },
  async render(text, variables) {
    const workspace = await models.workspace.getById(workspaceId);
    if (!workspace) {
      return text;
    }
    const context = await getRenderContext({
      ancestors: await getRenderContextAncestors(workspace),
      environmentId,
      purpose: RENDER_PURPOSE_SEND,
      iterationData: variables,
    });
    return render(text, context);
  },
});
