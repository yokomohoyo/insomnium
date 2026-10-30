import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as models from '../../../models';

const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError } : {}) });

const headersSchema = z.array(z.object({ name: z.string(), value: z.string() }));

// A request's response examples (its Examples tab): saved responses that are
// part of the collection, which the mock server answers with
export function registerExampleTools(server: McpServer) {
  server.tool(
    'list_response_examples',
    "List an HTTP request's response examples (its Examples tab): name, status code and message, headers and body.",
    { requestId: z.string() },
    async ({ requestId }) => {
      const examples = await models.responseExample.findByParentId(requestId);
      return text(examples.map(({ _id, name, statusCode, statusMessage, headers, body }) => ({ id: _id, name, statusCode, statusMessage, headers, body })));
    },
  );

  server.tool(
    'create_response_example',
    'Add a response example to an HTTP request: what it should answer, as the mock server will.',
    {
      requestId: z.string(),
      name: z.string().default('Example'),
      statusCode: z.number().int().min(100).max(599).default(200),
      statusMessage: z.string().default('OK'),
      headers: headersSchema.default([]),
      body: z.string().default(''),
    },
    async ({ requestId, ...fields }) => {
      if (!await models.request.getById(requestId)) {
        return text({ error: 'requestId is not an HTTP request' }, true);
      }
      const example = await models.responseExample.create({ parentId: requestId, ...fields });
      return text({ ok: true, id: example._id, name: example.name });
    },
  );

  server.tool(
    'update_response_example',
    "Change a response example's name, status code or message, headers (replaced whole) or body.",
    {
      exampleId: z.string(),
      name: z.string().optional(),
      statusCode: z.number().int().min(100).max(599).optional(),
      statusMessage: z.string().optional(),
      headers: headersSchema.optional(),
      body: z.string().optional(),
    },
    async ({ exampleId, ...fields }) => {
      const example = await models.responseExample.getById(exampleId);
      if (!example) {
        return text({ error: 'response example not found' }, true);
      }
      const patch = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
      await models.responseExample.update(example, patch);
      return text({ ok: true, id: exampleId });
    },
  );

  server.tool(
    'delete_response_example',
    'Delete a response example.',
    { exampleId: z.string() },
    async ({ exampleId }) => {
      const example = await models.responseExample.getById(exampleId);
      if (!example) {
        return text({ error: 'response example not found' }, true);
      }
      await models.responseExample.remove(example);
      return text({ ok: true, id: exampleId });
    },
  );
}
