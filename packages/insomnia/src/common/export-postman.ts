// Postman Collection v2.1, from Insomnium's own export (export.tsx): the
// resources of one or more collections, so a team can take a collection to
// Postman as easily as it comes from there. gRPC and WebSocket requests have
// no Postman v2.1 form and are left out, as are sub environments, which are
// Postman environments rather than part of a collection.

const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

interface Resource {
  _id: string;
  _type: string;
  parentId: string | null;
  name?: string;
  description?: string;
  metaSortKey?: number;
  [key: string]: any;
}

interface KeyValue {
  key: string;
  value: unknown;
  type?: string;
  disabled?: boolean;
}

// Insomnium's {{ _.name }} and {{ name }} are Postman's {{name}}, and its
// faker tag is a Postman dynamic variable; other tags have no Postman form
export const toPostmanTemplate = (text: unknown): string => typeof text !== 'string' ? String(text ?? '') : text
  .replace(/{{\s*(?:_\.)?([\w.$-]+)\s*}}/g, '{{$1}}')
  .replace(/{%\s*faker\s+'([\w]+)'\s*%}/g, '{{$$$1}}');

const pairs = (entries: Record<string, unknown>): KeyValue[] =>
  Object.entries(entries).map(([key, value]) => ({ key, value: toPostmanTemplate(value), type: 'string' }));

const strategies = (authentication: unknown): any[] => {
  if (Array.isArray(authentication)) {
    return authentication;
  }
  return authentication && typeof authentication === 'object' && Object.keys(authentication).length ? [authentication] : [];
};

// The first auth a request or folder uses: undefined to inherit, as an empty
// auth does in Insomnium too
export const toPostmanAuth = (authentication: unknown): Record<string, unknown> | undefined => {
  const auth = strategies(authentication).find(strategy => !strategy.disabled);
  if (!auth) {
    return undefined;
  }
  const typed = (type: string, values: Record<string, unknown>) => ({ type, [type]: pairs(values) });
  switch (auth.type) {
    case 'none':
      return { type: 'noauth' };
    case 'basic':
      return typed('basic', { username: auth.username || '', password: auth.password || '' });
    case 'digest':
      return typed('digest', { username: auth.username || '', password: auth.password || '' });
    case 'ntlm':
      return typed('ntlm', { username: auth.username || '', password: auth.password || '', domain: auth.domain || '', workstation: auth.workstation || '' });
    case 'bearer':
      return typed('bearer', { token: auth.token || '' });
    case 'apikey':
      return typed('apikey', { key: auth.key || '', value: auth.value || '', in: auth.addTo === 'queryParams' ? 'query' : 'header' });
    case 'oauth1':
      return typed('oauth1', {
        consumerKey: auth.consumerKey || '', consumerSecret: auth.consumerSecret || '', token: auth.tokenKey || '', tokenSecret: auth.tokenSecret || '',
        signatureMethod: auth.signatureMethod || 'HMAC-SHA1', realm: auth.realm || '', nonce: auth.nonce || '', timestamp: auth.timestamp || '', version: auth.version || '1.0',
      });
    case 'oauth2':
      return typed('oauth2', {
        grant_type: auth.grantType === 'authorization_code' && auth.usePkce ? 'authorization_code_with_pkce' : auth.grantType === 'password' ? 'password_credentials' : auth.grantType || 'authorization_code',
        accessTokenUrl: auth.accessTokenUrl || '', authUrl: auth.authorizationUrl || '', clientId: auth.clientId || '', clientSecret: auth.clientSecret || '',
        scope: auth.scope || '', state: auth.state || '', redirect_uri: auth.redirectUrl || '', username: auth.username || '', password: auth.password || '',
        addTokenTo: 'header', headerPrefix: auth.tokenPrefix || 'Bearer',
      });
    case 'iam':
      return typed('awsv4', { accessKey: auth.accessKeyId || '', secretKey: auth.secretAccessKey || '', region: auth.region || '', service: auth.service || '', sessionToken: auth.sessionToken || '' });
    case 'hawk':
      return typed('hawk', { authId: auth.id || '', authKey: auth.key || '', algorithm: auth.algorithm || 'sha256' });
    case 'jwt':
      return typed('jwt', {
        algorithm: auth.algorithm || 'HS256', secret: auth.secret || '', isSecretBase64Encoded: auth.secretBase64 ? 'true' : 'false', privateKey: auth.privateKey || '',
        payload: auth.payload || '{}', header: auth.header || '{}', addTokenTo: auth.addTo === 'queryParams' ? 'queryParam' : 'header',
        headerPrefix: auth.prefix ?? 'Bearer', queryParamKey: auth.queryParamKey || 'token',
      });
    case 'edgegrid':
      return typed('edgegrid', { clientToken: auth.clientToken || '', clientSecret: auth.clientSecret || '', accessToken: auth.accessToken || '', headersToSign: auth.headersToSign || '', maxBody: auth.maxBody || '' });
    default:
      // ASAP, Netrc and GCP ID tokens have no Postman form
      return undefined;
  }
};

const RAW_LANGUAGES: [RegExp, string][] = [[/json/i, 'json'], [/xml/i, 'xml'], [/html/i, 'html'], [/javascript/i, 'javascript']];

export const toPostmanBody = (body: any): Record<string, unknown> | undefined => {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const mimeType: string = body.mimeType || '';
  const params = (body.params || []).filter((param: any) => param.name);
  if (mimeType === 'application/x-www-form-urlencoded') {
    return { mode: 'urlencoded', urlencoded: params.map((param: any) => ({ key: param.name, value: toPostmanTemplate(param.value), ...(param.disabled ? { disabled: true } : {}) })) };
  }
  if (mimeType === 'multipart/form-data') {
    return {
      mode: 'formdata',
      formdata: params.map((param: any) => ({
        key: param.name,
        ...(param.type === 'file' ? { type: 'file', src: param.fileName || '' } : { type: 'text', value: toPostmanTemplate(param.value) }),
        ...(param.disabled ? { disabled: true } : {}),
      })),
    };
  }
  if (mimeType === 'application/graphql') {
    let graphql: { query?: string; variables?: unknown } = {};
    try {
      graphql = JSON.parse(body.text || '{}');
    } catch {
      graphql = { query: body.text || '' };
    }
    return { mode: 'graphql', graphql: { query: toPostmanTemplate(graphql.query || ''), variables: toPostmanTemplate(typeof graphql.variables === 'string' ? graphql.variables : JSON.stringify(graphql.variables || {})) } };
  }
  if (body.fileName) {
    return { mode: 'file', file: { src: body.fileName } };
  }
  if (typeof body.text === 'string' && body.text) {
    const language = RAW_LANGUAGES.find(([pattern]) => pattern.test(mimeType))?.[1] || 'text';
    return { mode: 'raw', raw: toPostmanTemplate(body.text), options: { raw: { language } } };
  }
  return undefined;
};

const script = (listen: string, code?: string) => code?.trim() ? [{ listen, script: { type: 'text/javascript', exec: code.split('\n') } }] : [];

const toPostmanRequest = (request: Resource, examples: Resource[]) => {
  const parameters = (request.parameters || []).filter((param: any) => param.name);
  const query = parameters.map((param: any) => ({ key: param.name, value: toPostmanTemplate(param.value), ...(param.disabled ? { disabled: true } : {}) }));
  const enabledQuery = parameters.filter((param: any) => !param.disabled).map((param: any) => `${param.name}=${toPostmanTemplate(param.value)}`).join('&');
  const url = toPostmanTemplate(request.url || '');
  const variable = (request.segmentParams || []).filter((param: any) => param.name).map((param: any) => ({ key: param.name, value: toPostmanTemplate(param.value) }));
  const postmanRequest = {
    method: request.method || 'GET',
    header: (request.headers || []).filter((header: any) => header.name).map((header: any) => ({ key: header.name, value: toPostmanTemplate(header.value), ...(header.disabled ? { disabled: true } : {}) })),
    url: {
      raw: enabledQuery ? `${url}${url.includes('?') ? '&' : '?'}${enabledQuery}` : url,
      ...(query.length ? { query } : {}),
      ...(variable.length ? { variable } : {}),
    },
    ...(request.description ? { description: request.description } : {}),
  };
  const body = toPostmanBody(request.body);
  const auth = toPostmanAuth(request.authentication);
  const event = [...script('prerequest', request.preRequestScript), ...script('test', request.afterResponseScript)];
  return {
    name: request.name || url,
    request: { ...postmanRequest, ...(body ? { body } : {}), ...(auth ? { auth } : {}) },
    ...(event.length ? { event } : {}),
    response: examples.map(example => ({
      name: example.name || `${example.statusCode}`,
      originalRequest: { method: postmanRequest.method, header: postmanRequest.header, url: postmanRequest.url },
      status: example.statusMessage || '',
      code: example.statusCode || 200,
      header: (example.headers || []).map((header: any) => ({ key: header.name, value: header.value })),
      body: example.body || '',
    })),
  };
};

export function toPostmanCollection(resources: Resource[], name: string) {
  const children = new Map<string | null, Resource[]>();
  for (const resource of resources) {
    children.set(resource.parentId, [...(children.get(resource.parentId) || []), resource]);
  }
  const sorted = (parentId: string) => [...(children.get(parentId) || [])].sort((a, b) => (a.metaSortKey ?? 0) - (b.metaSortKey ?? 0));
  // Postman's folders have no headers, so a folder's go to each request under
  // it, unless the request sets the same one
  const items = (parentId: string, inherited: any[] = []): any[] => sorted(parentId).flatMap((resource): any[] => {
    if (resource._type === 'request_group') {
      const auth = toPostmanAuth(resource.authentication);
      const own = (resource.headers || []).filter((header: any) => header.name && !header.disabled);
      const headers = [...inherited.filter(header => !own.some((mine: any) => mine.name.toLowerCase() === header.name.toLowerCase())), ...own];
      return [{
        name: resource.name || 'Folder',
        ...(resource.description ? { description: resource.description } : {}),
        item: items(resource._id, headers),
        ...(auth ? { auth } : {}),
      }];
    }
    if (resource._type === 'request') {
      const own = resource.headers || [];
      const headers = [...inherited.filter(header => !own.some((mine: any) => mine.name?.toLowerCase() === header.name.toLowerCase())), ...own];
      return [toPostmanRequest({ ...resource, headers }, sorted(resource._id).filter(child => child._type === 'response_example'))];
    }
    return [];
  });
  const workspaces = resources.filter(resource => resource._type === 'workspace');
  // a collection's variables are its base environment's
  const baseEnvironmentOf = (workspaceId: string) => resources.find(resource => resource._type === 'environment' && resource.parentId === workspaceId);
  const only = workspaces.length === 1 ? workspaces[0] : undefined;
  const variable = only ? Object.entries(baseEnvironmentOf(only._id)?.data || {}).map(([key, value]) => ({ key, value: typeof value === 'string' ? toPostmanTemplate(value) : JSON.stringify(value) })) : [];
  return {
    info: {
      name: only?.name || name,
      ...(only?.description ? { description: only.description } : {}),
      schema: SCHEMA,
    },
    item: only ? items(only._id) : workspaces.map(workspace => ({ name: workspace.name, item: items(workspace._id) })),
    ...(variable.length ? { variable } : {}),
  };
}
