import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { exportWorkspacesData } from '../../../common/export-data';
import { docsFromExport } from '../../../common/export-docs';
import { toOpenApiYaml } from '../../../common/export-openapi';
import { toPostmanCollection } from '../../../common/export-postman';
import { importResourcesToWorkspace, scanResources } from '../../../common/import';
import * as models from '../../../models';
import { listRunnableRequests, runRequests } from '../../../network/runner';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

// Whole-collection tools: folders, cookies, import and export, and the runner
export function registerCollectionTools(server: McpServer) {
  server.tool(
    'create_request_group',
    'Create a folder in a workspace or in another folder (parentId), to group requests.',
    { parentId: z.string(), name: z.string().default('New Folder'), description: z.string().optional() },
    async ({ parentId, name, description }) => {
      if (!await models.workspace.getById(parentId) && !await models.requestGroup.getById(parentId)) {
        return text({ error: 'parentId is not a workspace or folder' }, true);
      }
      const folder = await models.requestGroup.create({ parentId, name, ...(description ? { description } : {}) });
      return text({ ok: true, requestGroupId: folder._id });
    },
  );

  server.tool(
    'list_cookies',
    "List the cookies in a workspace's cookie jar: domain, path, name, expiry. Values are left out unless showValues is true, since they're often session tokens.",
    { workspaceId: z.string(), showValues: z.boolean().default(false) },
    async ({ workspaceId, showValues }) => {
      const jar = await models.cookieJar.getOrCreateForParentId(workspaceId);
      return text(jar.cookies.map(({ domain, path, key, value, expires, secure, httpOnly }) => ({
        domain, path, name: key, ...(showValues ? { value } : {}), expires, secure, httpOnly,
      })));
    },
  );

  server.tool(
    'export_workspace',
    "Export a workspace: as Insomnium's v4 JSON (to back it up, or move it to another Insomnium or Insomnia), as a Postman Collection v2.1, as an OpenAPI 3.0 description (YAML) of its HTTP requests, or as API documentation in Markdown or as one HTML page (from its design document's spec, or else its requests). Private environments are left out unless includePrivate is true.",
    { workspaceId: z.string(), format: z.enum(['insomnium', 'postman', 'openapi', 'markdown', 'html']).default('insomnium'), includePrivate: z.boolean().default(false) },
    async ({ workspaceId, format, includePrivate }) => {
      const workspace = await models.workspace.getById(workspaceId);
      if (!workspace) {
        return text({ error: 'workspace not found' }, true);
      }
      const exported = await exportWorkspacesData([workspace], includePrivate, 'json');
      const { resources } = JSON.parse(exported);
      return text(format === 'postman' ? JSON.stringify(toPostmanCollection(resources, workspace.name), null, 2)
        : format === 'openapi' ? toOpenApiYaml(resources, workspace.name)
          : format === 'markdown' || format === 'html' ? docsFromExport(resources, workspace.name, format)
            : exported);
    },
  );

  server.tool(
    'import_collection',
    'Import requests into a workspace from text in any format the app imports: an Insomnium or Insomnia export, a Postman collection or environment, Bruno, OpenAPI or Swagger, HAR, a curl command, WSDL.',
    { workspaceId: z.string(), content: z.string() },
    async ({ workspaceId, content }) => {
      if (!await models.workspace.getById(workspaceId)) {
        return text({ error: 'workspace not found' }, true);
      }
      const scanned = await scanResources({ content });
      if (scanned.errors?.length) {
        return text({ error: scanned.errors.join('; ') }, true);
      }
      await importResourcesToWorkspace({ workspaceId });
      return text({
        ok: true,
        format: scanned.type?.name,
        imported: { requests: scanned.requests?.length || 0, environments: scanned.environments?.length || 0 },
      });
    },
  );

  server.tool(
    'run_requests',
    "Run a workspace's or folder's HTTP requests in order (parentId), as the app's runner does: each is sent with its scripts, and its assertions and script tests are checked. Returns each request's result and a summary.",
    {
      parentId: z.string(),
      environmentId: z.string().optional().describe('a sub environment; the active one when left out'),
      iterations: z.number().int().min(1).max(100).default(1),
      bail: z.boolean().default(false).describe('stop at the first request that fails'),
    },
    async ({ parentId, environmentId, iterations, bail }) => {
      const requests = await listRunnableRequests(parentId);
      if (!requests.length) {
        return text({ error: 'no HTTP requests under parentId' }, true);
      }
      const summary = await runRequests(requests, { environmentId, iterations, bail });
      return text({
        passed: summary.requests.failed === 0,
        summary: summary.requests,
        assertions: summary.assertions,
        elapsedMs: summary.elapsedTime,
        results: summary.results.map(({ iteration, name, folders, method, url, statusCode, error, passed, assertions }) => ({
          iteration, name: [...folders, name].join(' / '), method, url, statusCode, error, passed,
          assertions: assertions.map(({ passed, message }) => ({ passed, message })),
        })),
      }, summary.requests.failed > 0);
    },
  );
}
