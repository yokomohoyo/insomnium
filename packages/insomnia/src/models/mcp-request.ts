import { database } from '../common/database';
import type { BaseModel } from '.';
import { RequestHeader } from './request';

// A connection to an MCP server, to try its tools, prompts and resources
// (main/network/mcp-client.ts): over streamable HTTP (with SSE as the older
// fallback), or a command run on this computer that speaks MCP on stdio.
export const name = 'MCP Request';

export const type = 'McpRequest';

export const prefix = 'mcp-req';

export const canDuplicate = true;

export const canSync = true;

// kept only when set, so requests without them sync as before
export const optionalKeys = ['toolArguments'];

export type McpTransport = 'http' | 'stdio';

export interface BaseMcpRequest {
  name: string;
  description: string;
  transport: McpTransport;
  // streamable HTTP: the server's URL, with these headers (auth goes here)
  url: string;
  headers: RequestHeader[];
  // stdio: the command and its arguments, one argument per line
  command: string;
  args: string;
  metaSortKey: number;
  // the arguments last used for each tool, as JSON text
  toolArguments?: Record<string, string>;
}

export type McpRequest = BaseModel & BaseMcpRequest & { type: typeof type };

export const isMcpRequest = (model: Pick<BaseModel, 'type'>): model is McpRequest => (
  model.type === type
);

export const isMcpRequestId = (id: string | null) => (
  id?.startsWith(`${prefix}_`)
);

export const init = (): BaseMcpRequest => ({
  name: 'New MCP Request',
  description: '',
  transport: 'http',
  url: '',
  headers: [],
  command: '',
  args: '',
  metaSortKey: -1 * Date.now(),
});

export const migrate = (doc: McpRequest) => doc;

export const create = (patch: Partial<McpRequest> = {}) => {
  if (!patch.parentId) {
    throw new Error(`New McpRequest missing \`parentId\`: ${JSON.stringify(patch)}`);
  }

  return database.docCreate<McpRequest>(type, patch);
};

export const remove = (obj: McpRequest) => database.remove(obj);

export const update = (
  obj: McpRequest,
  patch: Partial<McpRequest> = {}
) => database.docUpdate(obj, patch);

export async function duplicate(request: McpRequest, patch: Partial<McpRequest> = {}) {
  if (!patch.name && request.name) {
    patch.name = `${request.name} (Copy)`;
  }
  // after the original, before the next one
  // @ts-expect-error -- Database TSCONVERSION
  const [nextRequest] = await database.find<McpRequest>(type, { metaSortKey: { $gt: request.metaSortKey } }, { metaSortKey: 1 });
  const nextSortKey = nextRequest ? nextRequest.metaSortKey : request.metaSortKey + 100;
  const metaSortKey = request.metaSortKey + (nextSortKey - request.metaSortKey) / 2;
  return database.duplicate<McpRequest>(request, { metaSortKey, ...patch });
}

export const getById = (_id: string) => database.getWhere<McpRequest>(type, { _id });

export const findByParentId = (parentId: string) => database.find<McpRequest>(type, { parentId });

export const all = () => database.all<McpRequest>(type);
