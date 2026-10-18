// The JSON Schema of a synced folder's files (layout.ts), written beside them
// as .insomnium/folder.schema.json: each file names it on its first line, so
// an editor with YAML support (VS Code's YAML extension, JetBrains IDEs, Zed,
// Neovim) completes and checks requests as they're written by hand.

export const SCHEMA_DIR = '.insomnium';
export const SCHEMA_FILE = 'folder.schema.json';

const text = (description: string) => ({ type: 'string', description });
const named = (description: string) => ({
  type: 'array',
  description,
  items: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      value: { type: 'string' },
      description: { type: 'string' },
      disabled: { type: 'boolean' },
    },
  },
});
const ofType = (type: string | string[], properties: Record<string, unknown>) => ({
  if: { properties: { type: Array.isArray(type) ? { enum: type } : { const: type } }, required: ['type'] },
  then: { properties },
});

const commonRequest = {
  url: text('The URL; {{ variables }} and {% tags %} are rendered when it is sent'),
  description: text('Its docs, in Markdown'),
  headers: named('Headers sent with it'),
  authentication: {
    type: 'object',
    description: 'Its auth: an empty one ({}) uses its folders\'',
    properties: {
      type: { enum: ['none', 'basic', 'digest', 'bearer', 'apikey', 'oauth1', 'oauth2', 'iam', 'hawk', 'ntlm', 'asap', 'netrc', 'gcp-id-token', 'jwt', 'edgegrid'] },
      disabled: { type: 'boolean' },
    },
  },
};

export const folderSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: `https://github.com/yokomohoyo/insomnium/blob/main/docs/folder-sync.md`,
  title: 'A file of an Insomnium collection kept in a folder',
  description: 'See Folder Sync in Insomnium\'s docs. A file is read only when it says its type; it gets an _id when Insomnium takes it in.',
  type: 'object',
  required: ['type'],
  properties: {
    _id: text('Kept by Insomnium: the same _id is the same item, wherever its file is'),
    type: {
      description: 'What the file is: the collection (insomnium.yaml), a folder (_folder.yaml), an environment (in environments/), or a request',
      enum: ['Workspace', 'RequestGroup', 'Environment', 'Request', 'GrpcRequest', 'WebSocketRequest', 'McpRequest'],
    },
    name: text('Its name; the file is named after it'),
    order: { type: 'number', description: 'Where it sits among the others in its folder, lowest first' },
  },
  allOf: [
    ofType('Request', {
      ...commonRequest,
      method: { type: 'string', description: 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, or any other', examples: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      parameters: named('Query parameters'),
      segmentParams: named('Values for the URL\'s :name segments'),
      body: {
        type: 'object',
        properties: {
          mimeType: { type: ['string', 'null'], examples: ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain', 'application/graphql'] },
          text: { type: 'string' },
          params: named('Form fields'),
        },
      },
      assertions: {
        type: 'array',
        description: 'Checks on the response',
        items: {
          type: 'object',
          required: ['source', 'operator'],
          properties: {
            id: { type: 'string' },
            source: { enum: ['status', 'header', 'jsonpath', 'body', 'responseTime'] },
            property: text('The header\'s name, or the JSON path'),
            operator: { type: 'string', examples: ['equals', 'notEquals', 'contains', 'notContains', 'greaterThan', 'lessThan', 'exists', 'notExists', 'matches', 'matchesSchema', 'matchesSpec'] },
            value: { type: 'string' },
            disabled: { type: 'boolean' },
          },
        },
      },
      preRequestScript: text('JavaScript run before it is sent, with the insomnia (or pm) API'),
      afterResponseScript: text('JavaScript run on its response'),
      examples: {
        type: 'array',
        description: 'Responses it should give, for the mock server and docs',
        items: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            type: { const: 'ResponseExample' },
            name: { type: 'string' },
            statusCode: { type: 'integer' },
            headers: named('Its headers'),
            body: { type: 'string' },
          },
        },
      },
    }),
    ofType('GrpcRequest', {
      url: text('The server: host:port, or grpcs:// for TLS'),
      protoMethodName: text('/package.Service/Method'),
      body: { type: 'object', properties: { text: text('The message, as JSON') } },
      metadata: named('Metadata sent with it'),
    }),
    ofType('WebSocketRequest', {
      ...commonRequest,
      parameters: named('Query parameters'),
    }),
    ofType('McpRequest', {
      transport: { enum: ['http', 'stdio'] },
      url: text('The server\'s URL, for HTTP'),
      command: text('The command to run, for STDIO'),
      args: text('Its arguments'),
      headers: named('Headers sent with it, for HTTP'),
    }),
    ofType('Environment', {
      data: { type: 'object', description: 'Its variables, as {{ name }} uses them' },
      color: { type: ['string', 'null'] },
    }),
    ofType('RequestGroup', {
      description: text('Its docs, in Markdown'),
      headers: named('Headers sent with each request in it'),
      authentication: commonRequest.authentication,
    }),
  ],
};

// the line naming the schema, for a file at that path in the folder
export const schemaComment = (filePath: string) => {
  const depth = filePath.split('/').length - 1;
  return `# yaml-language-server: $schema=${'../'.repeat(depth)}${SCHEMA_DIR}/${SCHEMA_FILE}\n`;
};
