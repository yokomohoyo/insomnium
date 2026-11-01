import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { parseApiSpec } from '../../../common/api-specs';
import { ResourceCache, scanResources } from '../../../common/import';
import { syncSpecToWorkspace } from '../../../common/spec-sync';
import { spectralRulesetFor } from '../../../common/spectral-ruleset-path';
import * as models from '../../../models';
import { isDesign } from '../../../models/workspace';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

const SEVERITIES = ['error', 'warning', 'info', 'hint'] as const;

// a design document's spec, or why there isn't one to use
async function specOf(workspaceId: string) {
  const workspace = await models.workspace.getById(workspaceId);
  if (!workspace || !isDesign(workspace)) {
    return { error: 'workspaceId is not a design document' };
  }
  const spec = await models.apiSpec.getOrCreateForParentId(workspaceId);
  return spec.contents.trim() ? { spec } : { error: 'the spec is empty: set it with set_spec' };
}

// The Spec tab's lint results, with the ruleset it uses, line numbers from 1
async function lint(workspaceId: string, contents: string) {
  const { rulesetPath, source } = await spectralRulesetFor(workspaceId);
  // (loaded when first used: see ipc/main.ts)
  const { lintSpec } = await import('../../spectral-lint');
  const problems = (await lintSpec({ contents, rulesetPath })).map(({ severity, code, message, path, range }) => ({
    severity: SEVERITIES[severity] ?? 'info',
    code,
    message,
    line: range.start.line + 1,
    path: path.join('.'),
  }));
  return { ruleset: source, errors: problems.filter(problem => problem.severity === 'error').length, problems };
}

// What the Spec tab does with a design document's spec beyond reading and
// setting it (design.ts): lint it, and make its requests from it
export function registerSpecTools(server: McpServer) {
  server.tool(
    'lint_spec',
    "Lint a design document's API spec as the Spec tab does, with Spectral: its chosen ruleset, its git repository's .spectral.yaml, or the built-in OpenAPI or AsyncAPI rules. Returns each problem's severity (error, warning, info, hint), rule code, message, line and path.",
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const found = await specOf(workspaceId);
      if (!found.spec) {
        return text({ error: found.error }, true);
      }
      return text(await lint(workspaceId, found.spec.contents));
    },
  );

  server.tool(
    'generate_requests_from_spec',
    "Make a design document's requests from its OpenAPI or Swagger spec, as the Spec tab's Generate Request Collection does: a request for each operation, in folders by tag. Requests made from it before are updated rather than copied, and ones whose operations are gone are kept. Refuses a spec with lint errors (see lint_spec) or an AsyncAPI one.",
    { workspaceId: z.string() },
    async ({ workspaceId }) => {
      const found = await specOf(workspaceId);
      if (!found.spec) {
        return text({ error: found.error }, true);
      }
      const { contents } = found.spec;
      try {
        if (parseApiSpec(contents).format === 'asyncapi') {
          return text({ error: 'requests are generated from OpenAPI and Swagger documents, not AsyncAPI' }, true);
        }
      } catch {
        // the lint says what's wrong with it
      }
      const linted = await lint(workspaceId, contents);
      if (linted.errors) {
        return text({ error: `the spec has ${linted.errors} lint error(s): fix them first`, problems: linted.problems.filter(problem => problem.severity === 'error') }, true);
      }
      const scanned = await scanResources({ content: contents });
      if (scanned.errors.length || !ResourceCache) {
        return text({ error: scanned.errors[0] || 'no requests found in the spec' }, true);
      }
      const { added, updated, unchanged, notInSpec } = await syncSpecToWorkspace({ workspaceId, resources: ResourceCache.resources });
      const brief = ({ _id, name, method, url }: { _id: string; name: string; method: string; url: string }) => ({ id: _id, name, method, url });
      return text({ ok: true, added: added.map(brief), updated: updated.map(brief), unchanged: unchanged.length, notInSpec: notInSpec.map(brief) });
    },
  );
}
