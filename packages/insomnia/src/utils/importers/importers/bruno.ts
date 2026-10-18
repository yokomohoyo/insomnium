import type { AssertionOperator, RequestAssertion } from '../../../network/assertions';
import { Converter, Header, ImportRequest, Parameter, UNKNOWN, UNKNOWN_OBJ } from '../entities';

export const id = 'bruno';
export const name = 'Bruno';
export const description = 'Bruno collection or environment export (JSON)';

// Bruno's collection export (Share > Bruno Collection): one JSON file whose
// items nest folders and requests. The collection and each folder keep their
// auth, headers, variables and scripts in `root.request`. gRPC and WebSocket
// requests are left out.

interface KeyValue {
  name?: string;
  value?: unknown;
  enabled?: boolean;
  type?: string;
  contentType?: string;
}

interface BrunoRequest {
  url?: string;
  method?: string;
  headers?: KeyValue[];
  params?: KeyValue[];
  // exports from before params had a type
  query?: KeyValue[];
  body?: UNKNOWN_OBJ;
  auth?: UNKNOWN_OBJ;
  script?: { req?: string; res?: string };
  vars?: { req?: KeyValue[]; res?: KeyValue[] };
  assertions?: KeyValue[];
  tests?: string;
  docs?: string;
}

interface Item {
  type?: string;
  name?: string;
  seq?: number;
  settings?: UNKNOWN_OBJ;
  request?: BrunoRequest;
  root?: { request?: BrunoRequest; docs?: string };
  docs?: string;
  items?: Item[];
}

const HTTP = ['http', 'http-request', 'graphql', 'graphql-request'];

const isEnabled = (pair: KeyValue) => pair.enabled !== false;
const text = (value: unknown) => value === undefined || value === null ? '' : String(value);
const variables = (pairs: KeyValue[] = []) =>
  Object.fromEntries(pairs.filter(pair => isEnabled(pair) && pair.name).map(pair => [pair.name, text(pair.value)]));

// Bruno sends a Content-Type for the body's mode unless the request sets one;
// Insomnium only sends the headers the request has
const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  sparql: 'application/sparql-query',
  formUrlEncoded: 'application/x-www-form-urlencoded',
  multipartForm: 'multipart/form-data',
  graphql: 'application/json',
};

const importBody = (body: UNKNOWN_OBJ = {}): ImportRequest['body'] => {
  switch (body.mode) {
    case 'json':
    case 'text':
    case 'xml':
    case 'sparql':
      return body[body.mode] ? { mimeType: CONTENT_TYPES[body.mode], text: text(body[body.mode]) } : {};
    case 'formUrlEncoded':
      return {
        mimeType: CONTENT_TYPES.formUrlEncoded,
        params: (body.formUrlEncoded || []).map((pair: KeyValue) => ({ name: text(pair.name), value: text(pair.value), disabled: !isEnabled(pair) })),
      };
    case 'multipartForm':
      return {
        mimeType: CONTENT_TYPES.multipartForm,
        params: (body.multipartForm || []).flatMap((pair: KeyValue): Parameter[] => pair.type === 'file'
          // a file field can hold several files
          ? [pair.value].flat().filter(Boolean).map(file => ({ name: text(pair.name), type: 'file', fileName: text(file), disabled: !isEnabled(pair) }))
          : [{ name: text(pair.name), value: text(pair.value), disabled: !isEnabled(pair) }]),
      };
    case 'graphql': {
      const { query = '', variables: graphqlVariables = '' } = body.graphql || {};
      let parsed: unknown;
      try {
        parsed = graphqlVariables.trim() ? JSON.parse(graphqlVariables) : undefined;
      } catch {
        parsed = undefined;
      }
      return { mimeType: 'application/graphql', text: JSON.stringify({ query, ...(parsed ? { variables: parsed } : {}) }) };
    }
    case 'file': {
      const selected = (body.file || []).find((file: UNKNOWN_OBJ) => file.selected) || (body.file || [])[0];
      return selected?.filePath ? { mimeType: selected.contentType || 'application/octet-stream', fileName: selected.filePath } as ImportRequest['body'] : {};
    }
    default:
      return {};
  }
};

// Bruno's "inherit" auth is resolved here, to the nearest folder's or the
// collection's, since Insomnium has no folder auth yet
const importAuth = (auth: UNKNOWN_OBJ = {}): UNKNOWN_OBJ => {
  switch (auth.mode) {
    case 'basic':
      return { type: 'basic', username: auth.basic?.username || '', password: auth.basic?.password || '', disabled: false };
    case 'bearer':
      return { type: 'bearer', token: auth.bearer?.token || '', prefix: '', disabled: false };
    case 'digest':
      return { type: 'digest', username: auth.digest?.username || '', password: auth.digest?.password || '', disabled: false };
    case 'ntlm': {
      const { username = '', password = '', domain = '' } = auth.ntlm || {};
      return { type: 'ntlm', username: domain ? `${domain}\\${username}` : username, password, disabled: false };
    }
    case 'awsv4': {
      const { accessKeyId = '', secretAccessKey = '', sessionToken = '', region = '', service = '' } = auth.awsv4 || {};
      return { type: 'iam', accessKeyId, secretAccessKey, sessionToken, region, service, disabled: false };
    }
    case 'apikey':
      return {
        type: 'apikey',
        key: auth.apikey?.key || '',
        value: auth.apikey?.value || '',
        addTo: auth.apikey?.placement === 'queryparams' ? 'queryParams' : 'header',
        disabled: false,
      };
    case 'oauth1': {
      const oauth1 = auth.oauth1 || {};
      return {
        type: 'oauth1',
        consumerKey: oauth1.consumerKey || '',
        consumerSecret: oauth1.consumerSecret || '',
        tokenKey: oauth1.accessToken || '',
        tokenSecret: oauth1.accessTokenSecret || '',
        callback: oauth1.callbackUrl || '',
        verifier: oauth1.verifier || '',
        signatureMethod: oauth1.signatureMethod || 'HMAC-SHA1',
        privateKey: oauth1.privateKey || '',
        timestamp: oauth1.timestamp || '',
        nonce: oauth1.nonce || '',
        version: oauth1.version || '1.0',
        realm: oauth1.realm || '',
        disabled: false,
      };
    }
    case 'oauth2': {
      const oauth2 = auth.oauth2 || {};
      return {
        type: 'oauth2',
        grantType: oauth2.grantType || 'authorization_code',
        accessTokenUrl: oauth2.accessTokenUrl || '',
        authorizationUrl: oauth2.authorizationUrl || '',
        clientId: oauth2.clientId || '',
        clientSecret: oauth2.clientSecret || '',
        scope: oauth2.scope || '',
        state: oauth2.state || '',
        redirectUrl: oauth2.callbackUrl || '',
        username: oauth2.username || '',
        password: oauth2.password || '',
        usePkce: !!oauth2.pkce,
        credentialsInBody: (oauth2.credentialsPlacement || 'body') === 'body',
        tokenPrefix: oauth2.tokenHeaderPrefix || '',
        disabled: false,
      };
    }
    default:
      return {};
  }
};

// Bruno's assertion operators that have an Insomnium one; the rest are kept as
// text. A value with no operator word means eq.
const OPERATORS: Record<string, AssertionOperator> = {
  eq: 'equals',
  neq: 'notEquals',
  gt: 'greaterThan',
  lt: 'lessThan',
  contains: 'contains',
  notContains: 'notContains',
  isDefined: 'exists',
  isUndefined: 'notExists',
};
const BRUNO_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'contains', 'notContains', 'length', 'matches', 'notMatches', 'startsWith', 'endsWith', 'between'];
const UNARY_OPERATORS = ['isEmpty', 'isNotEmpty', 'isNull', 'isUndefined', 'isDefined', 'isTruthy', 'isFalsy', 'isJson', 'isNumber', 'isString', 'isBoolean', 'isArray'];

const parseOperator = (expression: string) => {
  const [word, ...rest] = expression.trim().split(' ');
  if (UNARY_OPERATORS.includes(word)) {
    return { operator: word, value: '' };
  }
  return BRUNO_OPERATORS.includes(word) ? { operator: word, value: rest.join(' ') } : { operator: 'eq', value: expression };
};

// Bruno's right-hand side is a JS literal: "a string", 200, true
const unquote = (value: string) => {
  const trimmed = value.trim();
  return /^(["'`]).*\1$/s.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
};

// res.status, res.body, res.body.data[0].id, res.headers['content-type']
const assertionTarget = (expression = ''): Pick<RequestAssertion, 'source' | 'property'> | null => {
  const left = expression.trim();
  if (/^res\.(status|getStatus\(\))$/.test(left)) {
    return { source: 'status' };
  }
  if (/^res\.(responseTime|getResponseTime\(\))$/.test(left)) {
    return { source: 'responseTime' };
  }
  if (/^res\.(body|getBody\(\))$/.test(left)) {
    return { source: 'body' };
  }
  const path = left.match(/^res\.body((?:\.[A-Za-z_$][\w$]*|\[\d+\]|\[(["']).*?\2\])+)$/);
  if (path) {
    return { source: 'jsonpath', property: `$${path[1]}` };
  }
  const header = left.match(/^res\.headers\.([A-Za-z_$][\w$]*)$/)
    || left.match(/^res\.headers\[(["'])(.+?)\1\]$/)
    || left.match(/^res\.getHeader\((["'])(.+?)\1\)$/);
  if (header) {
    return { source: 'header', property: header[2] ?? header[1] };
  }
  return null;
};

const importAssertions = (assertions: KeyValue[] = []) => {
  const converted: RequestAssertion[] = [];
  const kept: string[] = [];
  assertions.forEach(assertion => {
    const { operator, value } = parseOperator(text(assertion.value));
    const target = assertionTarget(assertion.name);
    if (target && OPERATORS[operator]) {
      converted.push({
        id: `asrt_bruno${converted.length + 1}`,
        ...(isEnabled(assertion) ? {} : { disabled: true }),
        ...target,
        operator: OPERATORS[operator],
        ...(value ? { value: unquote(value) } : {}),
      });
    } else {
      kept.push(`${assertion.name}: ${text(assertion.value)}${isEnabled(assertion) ? '' : ' (disabled)'}`);
    }
  });
  return { converted, kept };
};

// Insomnium can't run Bruno's scripts and tests, so they're kept as text in
// the description, like the assertions and variables it has no place for
const block = (title: string, code?: string, language = 'js') => {
  const trimmed = (code || '').trim();
  if (!trimmed) {
    return [];
  }
  const fence = '`'.repeat(Math.max(3, ...(trimmed.match(/`+/g) || []).map(run => run.length + 1)));
  return [`**Bruno ${title}**, not run by Insomnium:\n\n${fence}${language}\n${trimmed}\n${fence}`];
};

const withNotes = (docs: string | undefined, request: BrunoRequest = {}, keptAssertions: string[] = []) => [
  (docs || '').trim(),
  ...block('pre-request script', request.script?.req),
  ...block('post-response script', request.script?.res),
  ...block('tests', request.tests),
  ...block('post-response variables', (request.vars?.res || []).map(pair => `${pair.name}: ${text(pair.value)}`).join('\n'), ''),
  ...block('assertions', keptAssertions.join('\n'), ''),
].filter(Boolean).join('\n\n');

// A request's own variables come first in Bruno, before the folder's and the
// environment's. Insomnium has no request variables, so they're put in place.
const withRequestVariables = <T>(value: T, values: Record<string, string>): T => {
  if (!Object.keys(values).length) {
    return value;
  }
  if (typeof value === 'string') {
    return value.replace(/{{\s*([\w.-]+)\s*}}/g, (match, variable) => Object.prototype.hasOwnProperty.call(values, variable) ? values[variable] : match) as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => withRequestVariables(item, values)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withRequestVariables(item, values)])) as T;
  }
  return value;
};

// The editor pairs segment params with the URL's :name segments by position,
// through an id ending in `ending<index>` (request-segment-editor.tsx)
const segmentParams = (url: string, params: KeyValue[]) => {
  if (!params.length) {
    return undefined;
  }
  return [...url.matchAll(/\:([\w_-]*?)(?=($|[^[\w_-]))/g)]
    .map(match => match[1])
    .filter(name => name !== '' && Number.isNaN(parseInt(name)))
    .map((name, index) => ({
      name,
      value: text(params.find(param => param.name === name)?.value),
      disabled: false,
      id: `pair_ending${index}`,
    }));
};

const sameName = (a: Header, b: Header) => (a.name || '').toLowerCase() === (b.name || '').toLowerCase();

const isEnvironment = (environment: UNKNOWN) =>
  typeof environment?.name === 'string'
  && Array.isArray(environment.variables)
  && environment.variables.every((variable: UNKNOWN) => typeof variable?.name === 'string');

// An environment on its own has nothing else, so other formats with a name
// and variables (a Hoppscotch collection) aren't taken for one
const ENVIRONMENT_KEYS = ['uid', 'name', 'variables', 'color', 'extends'];
const isLoneEnvironment = (environment: UNKNOWN) =>
  isEnvironment(environment) && Object.keys(environment).every(key => ENVIRONMENT_KEYS.includes(key));

// Bruno environments become sub environments: each also gets the collection's
// variables as defaults, which Bruno puts below the environment's
const importEnvironments = (environments: UNKNOWN[], defaults: Record<string, string>): ImportRequest[] =>
  environments.map((environment, index) => ({
    _id: `__ENV_${index + 1}__`,
    _type: 'environment',
    parentId: '__BASE_ENVIRONMENT_ID__',
    name: environment.name || `Environment ${index + 1}`,
    data: { ...defaults, ...variables(environment.variables) },
    ...(typeof environment.color === 'string' ? { color: environment.color } : {}),
  }));

export const convert: Converter = rawData => {
  let collection: UNKNOWN;
  try {
    collection = JSON.parse(rawData);
  } catch {
    return null;
  }

  // An environment export: a file of them, a list, or one
  if (collection?.info?.type === 'bruno-environment' && Array.isArray(collection.environments) && collection.environments.every(isEnvironment)) {
    return importEnvironments(collection.environments, {});
  }
  const list = Array.isArray(collection) ? collection : [collection];
  if (list.length && list.every(isLoneEnvironment)) {
    return importEnvironments(list, {});
  }

  if (
    typeof collection?.version !== 'string'
    || typeof collection.name !== 'string'
    || !Array.isArray(collection.items)
    || !Array.isArray(collection.environments ?? [])
    || 'info' in collection
  ) {
    return null;
  }

  let count = 0;
  const root: BrunoRequest = collection.root?.request || {};
  const collectionVariables = variables(root.vars?.req);
  const environments: UNKNOWN[] = (collection.environments || []).filter(isEnvironment);
  // the collection's variables go in the collection folder when there's no
  // environment to hold them (an import into a workspace keeps its own base)
  const resources = importEnvironments(environments, collectionVariables);

  const collectionFolderId = `__GRP_${++count}__`;
  resources.push({
    _id: collectionFolderId,
    _type: 'request_group',
    parentId: '__WORKSPACE_ID__',
    name: collection.name,
    description: withNotes(collection.root?.docs, root),
    environment: environments.length ? {} : collectionVariables,
  });

  const walk = (items: Item[], parentId: string, inheritedAuth: UNKNOWN_OBJ, inheritedHeaders: Header[]) => {
    [...items]
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      .forEach((item, index) => {
        if (item.type === 'folder') {
          const folder: BrunoRequest = item.root?.request || {};
          const folderHeaders = (folder.headers || []).filter(isEnabled).map(({ name, value }) => ({ name: text(name), value: text(value) }));
          const _id = `__GRP_${++count}__`;
          resources.push({
            _id,
            _type: 'request_group',
            parentId,
            name: item.name || '',
            description: withNotes(item.root?.docs, folder),
            environment: variables(folder.vars?.req),
            metaSortKey: index,
          } as ImportRequest);
          walk(
            item.items || [],
            _id,
            folder.auth?.mode && folder.auth.mode !== 'inherit' ? folder.auth : inheritedAuth,
            [...folderHeaders, ...inheritedHeaders.filter(header => !folderHeaders.some(own => sameName(own, header)))],
          );
          return;
        }
        if (!HTTP.includes(item.type || '') || !item.request) {
          return;
        }

        const request = item.request;
        const params = request.params || (request.query || []).map(pair => ({ ...pair, type: 'query' }));
        const queryParams = params.filter(param => param.type !== 'path');
        // the URL keeps the query string the params already hold
        let url = text(request.url);
        if (queryParams.length && url.includes('?')) {
          url = url.slice(0, url.indexOf('?'));
        }
        const ownHeaders: Header[] = (request.headers || []).map(header => ({
          name: text(header.name),
          value: text(header.value),
          ...(isEnabled(header) ? {} : { disabled: true }),
        }));
        const headers = [
          ...inheritedHeaders.filter(header => !ownHeaders.some(own => !own.disabled && sameName(own, header))),
          ...ownHeaders,
        ];
        const body = importBody(request.body);
        const contentType = CONTENT_TYPES[request.body?.mode];
        if (contentType && body && typeof body === 'object' && (body.text || body.params?.length) && !headers.some(header => !header.disabled && sameName(header, { name: 'Content-Type', value: '' }))) {
          headers.push({ name: 'Content-Type', value: contentType });
        }
        // the export writes none for a request with no auth
        const auth = request.auth?.mode === 'inherit' ? inheritedAuth : request.auth;
        const { converted, kept } = importAssertions(request.assertions);
        const settings = item.settings || {};
        const segments = segmentParams(url, params.filter(param => param.type === 'path'));

        resources.push(withRequestVariables({
          _id: `__REQ_${++count}__`,
          _type: 'request',
          parentId,
          name: item.name || '',
          description: withNotes(request.docs ?? item.docs, request, kept),
          method: (request.method || (item.type?.startsWith('graphql') ? 'POST' : 'GET')).toUpperCase(),
          url,
          parameters: queryParams.map(param => ({ name: text(param.name), value: text(param.value), disabled: !isEnabled(param) })),
          ...(segments ? { segmentParams: segments } : {}),
          headers,
          body,
          authentication: importAuth(auth),
          ...(converted.length ? { assertions: converted } : {}),
          ...(typeof settings.encodeUrl === 'boolean' ? { settingEncodeUrl: settings.encodeUrl } : {}),
          ...(typeof settings.followRedirects === 'boolean' ? { settingFollowRedirects: settings.followRedirects ? 'on' : 'off' } : {}),
          ...(Number(settings.timeout) > 0 ? { settingTimeout: Number(settings.timeout) } : {}),
          metaSortKey: index,
        } as ImportRequest, variables(request.vars?.req)));
      });
  };

  const rootHeaders = (root.headers || []).filter(isEnabled).map(({ name, value }) => ({ name: text(name), value: text(value) }));
  walk(collection.items, collectionFolderId, root.auth?.mode ? root.auth : {}, rootHeaders);
  return resources;
};
