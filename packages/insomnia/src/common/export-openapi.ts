// OpenAPI 3.0, from Insomnium's own export (export.tsx): a collection's HTTP
// requests as the operations of an API description, for documentation and mock
// tools, or to start a design document from requests you already have. A
// request is the operation of its method and path, its folder is its tag, its
// auth (or the folder's it inherits) is its security, and its saved response
// examples are its responses. The base environment and each sub environment
// give a server, where the URL's variables resolve. A second request for the
// same method and path (a variant of the first) is left out, as are gRPC and
// WebSocket requests, which have no OpenAPI form.
import YAML from 'yaml';

interface Resource {
  _id: string;
  _type: string;
  parentId: string | null;
  name?: string;
  description?: string;
  metaSortKey?: number;
  [key: string]: any;
}

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

// headers that the body, the auth or the app itself set
const LEFT_OUT_HEADERS = ['content-type', 'authorization', 'user-agent', 'content-length'];

const VARIABLE = /{{\s*(?:_\.)?([\w.$-]+)\s*}}/g;
const HAS_VARIABLE = /{{\s*(?:_\.)?[\w.$-]+\s*}}/;
const isTemplated = (text: string) => /{{|{%/.test(text);

// Insomnium's {{ _.name }} and {{ name }}, and a path's :name, are OpenAPI's {name}
export const toOpenApiPath = (path: string) => path
  .replace(VARIABLE, '{$1}')
  .replace(/\/:([\w.$-]+)/g, '/{$1}');

// a variable's value from an environment, its own variables resolved too
const resolve = (text: string, data: Record<string, any>) => {
  let resolved = text;
  for (let depth = 0; depth < 5 && HAS_VARIABLE.test(resolved); depth++) {
    resolved = resolved.replace(VARIABLE, (match, name) => typeof data[name] === 'string' || typeof data[name] === 'number' ? String(data[name]) : match);
  }
  return resolved;
};

// the server part of a URL, as written, and its path
export const splitUrl = (url: string): { server: string; path: string } => {
  const raw = (url || '').trim().split(/[?#]/)[0];
  const variableFirst = raw.match(/^({{\s*(?:_\.)?[\w.$-]+\s*}})(.*)$/);
  if (variableFirst) {
    return { server: variableFirst[1], path: variableFirst[2] || '/' };
  }
  const absolute = raw.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]*)(.*)$/i);
  if (absolute) {
    return { server: absolute[1], path: absolute[2] || '/' };
  }
  // no scheme: Insomnium sends these with http
  const slash = raw.indexOf('/');
  return slash === -1 ? { server: raw, path: '/' } : { server: raw.slice(0, slash), path: raw.slice(slash) };
};

const parseJson = (text: string) => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: undefined };
  }
};

// a schema for an example value, so tools that need one have it
export const schemaOf = (value: unknown): Record<string, unknown> => {
  if (Array.isArray(value)) {
    return { type: 'array', items: value.length ? schemaOf(value[0]) : {} };
  }
  if (value === null) {
    return { nullable: true };
  }
  if (typeof value === 'object') {
    return { type: 'object', properties: Object.fromEntries(Object.entries(value as object).map(([key, item]) => [key, schemaOf(item)])) };
  }
  if (typeof value === 'number') {
    return { type: Number.isInteger(value) ? 'integer' : 'number' };
  }
  return { type: typeof value === 'boolean' ? 'boolean' : 'string' };
};

// a value as an example, unless it's a variable or a tag, which mean nothing outside Insomnium
const exampleOf = (value: unknown) => typeof value === 'string' && value && !isTemplated(value) ? { example: value } : {};

const mediaOf = (mimeType: string, text: string) => {
  const json = /json/i.test(mimeType) ? parseJson(text) : { ok: false, value: undefined };
  return json.ok ? { schema: schemaOf(json.value), example: json.value } : { schema: { type: 'string' }, ...(text ? { example: text } : {}) };
};

const toRequestBody = (body: any) => {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const mimeType: string = body.mimeType || '';
  const params = (body.params || []).filter((param: any) => param.name && !param.disabled);
  if (mimeType === 'application/x-www-form-urlencoded' || mimeType === 'multipart/form-data') {
    const properties = Object.fromEntries(params.map((param: any) => [param.name, param.type === 'file'
      ? { type: 'string', format: 'binary' }
      : { type: 'string', ...exampleOf(param.value) }]));
    return { content: { [mimeType]: { schema: { type: 'object', properties } } } };
  }
  if (mimeType === 'application/graphql') {
    const graphql = parseJson(body.text || '{}');
    return { content: { 'application/json': { schema: { type: 'object', properties: { query: { type: 'string' }, variables: { type: 'object' } } }, ...(graphql.ok ? { example: graphql.value } : {}) } } };
  }
  if (body.fileName) {
    return { content: { [mimeType || 'application/octet-stream']: { schema: { type: 'string', format: 'binary' } } } };
  }
  if (typeof body.text === 'string' && body.text) {
    return { content: { [mimeType || 'text/plain']: mediaOf(mimeType, body.text) } };
  }
  return undefined;
};

const contentTypeOf = (example: Resource) =>
  (example.headers || []).find((header: any) => header.name?.toLowerCase() === 'content-type')?.value?.split(';')[0].trim();

const toResponses = (examples: Resource[]) => {
  if (!examples.length) {
    return { default: { description: 'Response' } };
  }
  const byStatus = new Map<string, Resource[]>();
  for (const example of examples) {
    const status = String(example.statusCode || 200);
    byStatus.set(status, [...(byStatus.get(status) || []), example]);
  }
  return Object.fromEntries([...byStatus].map(([status, sameStatus]) => {
    const [first] = sameStatus;
    const mimeType = contentTypeOf(first) || (parseJson(first.body || '').ok ? 'application/json' : 'text/plain');
    const media = mediaOf(mimeType, first.body || '');
    const content = sameStatus.length === 1
      ? media
      : { schema: media.schema, examples: Object.fromEntries(sameStatus.map((example, index) => [example.name || `example${index + 1}`, { value: mediaOf(mimeType, example.body || '').example }])) };
    return [status, {
      description: first.statusMessage || first.name || 'Response',
      ...(first.body ? { content: { [mimeType]: content } } : {}),
    }];
  }));
};

const strategies = (authentication: unknown): any[] => {
  if (Array.isArray(authentication)) {
    return authentication;
  }
  return authentication && typeof authentication === 'object' && Object.keys(authentication).length ? [authentication] : [];
};

const scopesOf = (scope?: string) => Object.fromEntries((scope || '').split(/[\s,]+/).filter(Boolean).map(name => [name, '']));

// a security scheme's name and definition, for the auth OpenAPI can describe
const toSecurityScheme = (auth: any): [string, Record<string, unknown>] | undefined => {
  switch (auth.type) {
    case 'basic':
      return ['basicAuth', { type: 'http', scheme: 'basic' }];
    case 'digest':
      return ['digestAuth', { type: 'http', scheme: 'digest' }];
    case 'bearer':
      return ['bearerAuth', { type: 'http', scheme: 'bearer' }];
    case 'apikey': {
      const name = auth.key || 'api_key';
      const location = auth.addTo === 'queryParams' ? 'query' : auth.addTo === 'cookie' ? 'cookie' : 'header';
      return [`apiKey_${name.replace(/[^\w.-]/g, '_')}`, { type: 'apiKey', in: location, name }];
    }
    case 'oauth2': {
      const scopes = scopesOf(auth.scope);
      const flow = auth.grantType === 'client_credentials' ? ['clientCredentials', { tokenUrl: auth.accessTokenUrl || '', scopes }]
        : auth.grantType === 'password' ? ['password', { tokenUrl: auth.accessTokenUrl || '', scopes }]
          : auth.grantType === 'implicit' ? ['implicit', { authorizationUrl: auth.authorizationUrl || '', scopes }]
            : ['authorizationCode', { authorizationUrl: auth.authorizationUrl || '', tokenUrl: auth.accessTokenUrl || '', scopes }];
      return ['oauth2', { type: 'oauth2', flows: { [flow[0] as string]: flow[1] } }];
    }
    default:
      // AWS, Hawk, OAuth 1, NTLM, ASAP, Netrc and GCP ID tokens have no OpenAPI form
      return undefined;
  }
};

const operationIdOf = (name: string) => {
  const words = name.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  return words.map((word, index) => index ? word[0].toUpperCase() + word.slice(1) : word[0].toLowerCase() + word.slice(1)).join('') || 'operation';
};

export function toOpenApi(resources: Resource[], name: string) {
  const children = new Map<string | null, Resource[]>();
  for (const resource of resources) {
    children.set(resource.parentId, [...(children.get(resource.parentId) || []), resource]);
  }
  const sorted = (parentId: string) => [...(children.get(parentId) || [])].sort((a, b) => (a.metaSortKey ?? 0) - (b.metaSortKey ?? 0));
  const workspaces = resources.filter(resource => resource._type === 'workspace');
  const only = workspaces.length === 1 ? workspaces[0] : undefined;

  // requests in the sidebar's order, with their folders
  const requests: { request: Resource; folders: Resource[]; workspace: Resource }[] = [];
  const walk = (parentId: string, folders: Resource[], workspace: Resource) => {
    for (const resource of sorted(parentId)) {
      if (resource._type === 'request_group') {
        walk(resource._id, [...folders, resource], workspace);
      } else if (resource._type === 'request') {
        requests.push({ request: resource, folders, workspace });
      }
    }
  };
  workspaces.forEach(workspace => walk(workspace._id, [], workspace));

  // a workspace's environments: the base, then each sub environment over it
  const environmentsOf = (workspace: Resource) => {
    const base = resources.find(resource => resource._type === 'environment' && resource.parentId === workspace._id);
    if (!base) {
      return [];
    }
    const subs = resources.filter(resource => resource._type === 'environment' && resource.parentId === base._id);
    return [
      { name: base.name || 'Base Environment', data: base.data || {} },
      ...subs.map(sub => ({ name: sub.name || 'Environment', data: { ...base.data, ...sub.data } })),
    ];
  };
  const serversOf = (server: string, workspace: Resource) => {
    const servers = new Map<string, { url: string; description?: string }>();
    for (const environment of environmentsOf(workspace)) {
      const url = resolve(server, environment.data);
      if (url && !isTemplated(url)) {
        const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`;
        if (!servers.has(absolute)) {
          // which environment it is, when that's what decides it
          servers.set(absolute, { url: absolute.replace(/\/$/, ''), ...(HAS_VARIABLE.test(server) ? { description: environment.name } : {}) });
        }
      }
    }
    if (servers.size) {
      return [...servers.values()];
    }
    // none resolve: the URL's variables, for whoever uses the description to set
    const variables = [...server.matchAll(VARIABLE)].map(match => match[1]);
    return [{ url: toOpenApiPath(server), ...(variables.length ? { variables: Object.fromEntries(variables.map(variable => [variable, { default: '' }])) } : {}) }];
  };

  // the server most requests use is the description's; others are an operation's
  const serverCounts = new Map<string, number>();
  for (const { request } of requests) {
    const { server } = splitUrl(request.url);
    serverCounts.set(server, (serverCounts.get(server) || 0) + 1);
  }
  const mainServer = [...serverCounts].sort((a, b) => b[1] - a[1])[0]?.[0];

  // auth: the request's, or else the nearest folder's
  const authOf = (request: Resource, folders: Resource[]) => {
    for (const doc of [request, ...[...folders].reverse()]) {
      const auth = strategies(doc.authentication).find(strategy => !strategy.disabled);
      if (auth) {
        return auth;
      }
    }
    return undefined;
  };

  const paths: Record<string, Record<string, any>> = {};
  const tags = new Map<string, string | undefined>();
  const securitySchemes: Record<string, Record<string, unknown>> = {};
  const operationIds = new Set<string>();
  for (const { request, folders, workspace } of requests) {
    const method = (request.method || 'GET').toLowerCase();
    const { server, path: rawPath } = splitUrl(request.url);
    const path = toOpenApiPath(rawPath.startsWith('/') ? rawPath : `/${rawPath}`);
    if (!METHODS.includes(method) || paths[path]?.[method]) {
      continue;
    }

    const tag = [...(workspaces.length > 1 ? [workspace] : []), ...folders].map(folder => folder.name || 'Folder').join(' / ');
    if (tag && !tags.has(tag)) {
      tags.set(tag, folders[folders.length - 1]?.description || undefined);
    }

    const segmentValues = Object.fromEntries((request.segmentParams || []).map((param: any) => [param.name, param.value]));
    const pathParameters = [...path.matchAll(/{([^}]+)}/g)].map(match => ({
      name: match[1], in: 'path', required: true, schema: { type: 'string' }, ...exampleOf(segmentValues[match[1]]),
    }));
    const queryInUrl = [...new URLSearchParams((request.url || '').split('?')[1]?.split('#')[0] || '')].map(([key, value]) => ({ name: key, value }));
    const queryParameters = [...queryInUrl, ...(request.parameters || [])].filter((param: any) => param.name).map((param: any) => ({
      name: param.name, in: 'query', schema: { type: 'string' }, ...exampleOf(param.value), ...(param.description ? { description: param.description } : {}),
    }));
    const headerParameters = (request.headers || [])
      .filter((header: any) => header.name && !LEFT_OUT_HEADERS.includes(header.name.toLowerCase()))
      .map((header: any) => ({ name: header.name, in: 'header', schema: { type: 'string' }, ...exampleOf(header.value), ...(header.description ? { description: header.description } : {}) }));
    const parameters = [...pathParameters, ...queryParameters, ...headerParameters]
      .filter((param, index, all) => all.findIndex(other => other.name === param.name && other.in === param.in) === index);

    const auth = authOf(request, folders);
    const scheme = auth && auth.type !== 'none' ? toSecurityScheme(auth) : undefined;
    if (scheme) {
      securitySchemes[scheme[0]] = scheme[1];
    }
    const scopes = auth?.type === 'oauth2' ? Object.keys(scopesOf(auth.scope)) : [];

    let operationId = operationIdOf(request.name || `${method} ${path}`);
    for (let count = 2; operationIds.has(operationId); count++) {
      operationId = `${operationIdOf(request.name || `${method} ${path}`)}${count}`;
    }
    operationIds.add(operationId);

    const requestBody = ['get', 'head'].includes(method) ? undefined : toRequestBody(request.body);
    paths[path] = {
      ...paths[path],
      [method]: {
        ...(tag ? { tags: [tag] } : {}),
        summary: request.name || `${method.toUpperCase()} ${path}`,
        ...(request.description ? { description: request.description } : {}),
        operationId,
        ...(server !== mainServer ? { servers: serversOf(server, workspace) } : {}),
        ...(parameters.length ? { parameters } : {}),
        ...(requestBody ? { requestBody } : {}),
        responses: toResponses(sorted(request._id).filter(child => child._type === 'response_example')),
        ...(scheme ? { security: [{ [scheme[0]]: scopes }] } : auth?.type === 'none' ? { security: [] } : {}),
      },
    };
  }

  const mainWorkspace = only || workspaces[0];
  return {
    openapi: '3.0.3',
    info: {
      title: only?.name || name,
      ...(only?.description ? { description: only.description } : {}),
      version: '1.0.0',
    },
    ...(mainServer !== undefined && mainWorkspace ? { servers: serversOf(mainServer, mainWorkspace) } : {}),
    ...(tags.size ? { tags: [...tags].map(([tag, description]) => ({ name: tag, ...(description ? { description } : {}) })) } : {}),
    paths,
    ...(Object.keys(securitySchemes).length ? { components: { securitySchemes } } : {}),
  };
}

// as YAML; the JSON round trip leaves no shared objects for YAML to alias
export const toOpenApiYaml = (resources: Resource[], name: string) =>
  YAML.stringify(JSON.parse(JSON.stringify(toOpenApi(resources, name))));
