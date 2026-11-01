import YAML from 'yaml';

import { Converter, ImportRequest, UNKNOWN, UNKNOWN_OBJ } from '../entities';
import { InheritedScript, scriptAsText, withInheritedScripts } from '../scripts';

export const id = 'insomnia-5';
export const name = 'Insomnia v5';
export const description = 'Insomnia export format 5 (YAML)';

// Kong Insomnia's export since 11.0: one YAML file, folders nesting their
// children. Socket.IO requests, MCP clients and mock servers have no Insomnium
// model, so they're left out.
const COLLECTION = 'collection.insomnia.rest/5.0';
const SPEC = 'spec.insomnia.rest/5.0';
const ENVIRONMENTS = 'environment.insomnia.rest/5.0';

interface Meta {
  id?: string;
  description?: string;
  sortKey?: number;
  isPrivate?: boolean;
}

interface Scripts {
  preRequest?: string;
  afterResponse?: string;
}

// the folders' scripts, for the requests under them
interface Inherited {
  preRequest: InheritedScript[];
  afterResponse: InheritedScript[];
}

interface Header {
  name: string;
  value: string;
  disabled?: boolean;
}

// Insomnia's "inherit from parent" is an auth without a type
const hasAuth = (authentication?: UNKNOWN_OBJ) => typeof authentication?.type === 'string';

// The editor pairs segment params with the URL's :name segments by position,
// through an id ending in `ending<index>` (request-segment-editor.tsx)
const segmentParams = (url: string, pathParameters?: { name?: string; value?: string }[]) => {
  if (!pathParameters?.length) {
    return undefined;
  }
  return [...url.matchAll(/\:([\w_-]*?)(?=($|[^[\w_-]))/g)]
    .map(match => match[1])
    .filter(name => name !== '' && Number.isNaN(parseInt(name)))
    .map((name, index) => ({
      name,
      value: pathParameters.find(param => param.name === name)?.value || '',
      disabled: false,
      id: `pair_ending${index}`,
    }));
};

// A folder's scripts are kept as text in its description too, and so are a
// gRPC or WebSocket request's, which Insomnium doesn't run
const withScripts = (description = '', scripts: Scripts | undefined, note: string) => {
  const blocks = ([['pre-request script', scripts?.preRequest], ['after-response script', scripts?.afterResponse]] as const)
    .flatMap(([title, script]) => {
      const code = (script || '').trim();
      return code ? [scriptAsText(`Insomnia ${title}`, note, code)] : [];
    });
  return [description, ...blocks].filter(Boolean).join('\n\n');
};

export const convert: Converter = rawData => {
  let file: UNKNOWN;
  // Not this format, without parsing it (as insomnia-4.ts): its types all end
  // in insomnia.rest/5.0, which JSON may write with an escaped /
  if (!rawData.includes('insomnia.rest')) {
    return null;
  }
  try {
    file = YAML.parse(rawData);
  } catch (error) {
    return null;
  }
  if (![COLLECTION, SPEC, ENVIRONMENTS].includes(file?.type)) {
    return null;
  }

  // ids are replaced on import; these only have to be unique and carry the
  // model's prefix (sub environments are found by their parent's)
  let count = 0;
  const idFor = (meta: Meta | undefined, prefix: string) =>
    typeof meta?.id === 'string' && meta.id ? meta.id : `${prefix}_insomnia5_${++count}`;

  const resources: UNKNOWN_OBJ[] = [];
  const workspaceId = idFor(file.meta, 'wrk');
  const spec = file.type === ENVIRONMENTS ? undefined : file.spec;
  const specContents = spec?.contents && Object.keys(spec.contents).length ? spec.contents : undefined;
  resources.push({
    _id: workspaceId,
    _type: 'workspace',
    parentId: null,
    name: file.name || 'Imported Insomnia Collection',
    description: file.meta?.description || '',
    scope: file.type === SPEC || specContents ? 'design' : 'collection',
  });

  if (file.environments) {
    const environment = (env: UNKNOWN, _id: string, parentId: string, fallbackName: string) => ({
      _id,
      _type: 'environment',
      parentId,
      name: env.name || fallbackName,
      data: env.data || {},
      dataPropertyOrder: env.dataPropertyOrder || null,
      color: env.color || null,
      isPrivate: !!env.meta?.isPrivate,
      metaSortKey: env.meta?.sortKey ?? 0,
    });
    const baseId = idFor(file.environments.meta, 'env');
    resources.push(environment(file.environments, baseId, workspaceId, 'Base Environment'));
    (file.environments.subEnvironments || []).forEach((env: UNKNOWN, index: number) => {
      resources.push(environment(env, idFor(env.meta, 'env'), baseId, `Environment ${index + 1}`));
    });
  }

  if (file.cookieJar) {
    resources.push({
      _id: idFor(file.cookieJar.meta, 'jar'),
      _type: 'cookie_jar',
      parentId: workspaceId,
      name: file.cookieJar.name || 'Default Jar',
      cookies: file.cookieJar.cookies || [],
    });
  }

  // Insomnium has no folder auth or headers yet, so the nearest folder's are
  // copied onto the requests under it, as Insomnia would send them
  const walk = (items: UNKNOWN[] = [], parentId: string, inheritedAuth: UNKNOWN_OBJ, inheritedHeaders: Header[], inheritedScripts: Inherited) => {
    for (const item of items) {
      const meta: Meta = item.meta || {};
      const common = {
        parentId,
        name: item.name || '',
        description: withScripts(meta.description, item.scripts, 'not run by Insomnium'),
        metaSortKey: meta.sortKey ?? 0,
        isPrivate: !!meta.isPrivate,
      };
      const auth = hasAuth(item.authentication) ? item.authentication : inheritedAuth;
      const authentication = auth.type === 'none' ? {} : auth;
      const ownHeaders: Header[] = item.headers || [];
      const sameName = (a: Header, b: Header) => (a.name || '').toLowerCase() === (b.name || '').toLowerCase();
      const headers = [
        ...ownHeaders,
        ...inheritedHeaders.filter(header => !ownHeaders.some(own => !own.disabled && sameName(own, header))),
      ];

      if (!('method' in item) && !('reflectionApi' in item) && !('url' in item)) {
        const _id = idFor(meta, 'fld');
        resources.push({
          ...common,
          _id,
          _type: 'request_group',
          description: withScripts(meta.description, item.scripts, 'copied into each request under this folder, which runs it'),
          environment: item.environment || {},
          environmentPropertyOrder: item.environmentPropertyOrder || null,
        });
        const from = `Insomnia folder "${item.name || ''}"`;
        walk(item.children, _id, auth, headers.filter(header => !header.disabled), {
          preRequest: [...inheritedScripts.preRequest, { from, code: item.scripts?.preRequest || '' }],
          afterResponse: [...inheritedScripts.afterResponse, { from, code: item.scripts?.afterResponse || '' }],
        });
      } else if (item.method) {
        const settings = item.settings || {};
        const url = item.url || '';
        const params = segmentParams(url, item.pathParameters);
        const preRequestScript = withInheritedScripts(inheritedScripts.preRequest, item.scripts?.preRequest || '');
        const afterResponseScript = withInheritedScripts(inheritedScripts.afterResponse, item.scripts?.afterResponse || '');
        resources.push({
          ...common,
          _id: idFor(meta, 'req'),
          _type: 'request',
          description: meta.description || '',
          ...(preRequestScript.trim() ? { preRequestScript } : {}),
          ...(afterResponseScript.trim() ? { afterResponseScript } : {}),
          url,
          method: item.method,
          body: item.body || {},
          parameters: item.parameters || [],
          headers,
          authentication,
          ...(params ? { segmentParams: params } : {}),
          settingDisableRenderRequestBody: settings.renderRequestBody === false,
          settingEncodeUrl: settings.encodeUrl ?? true,
          settingFollowRedirects: settings.followRedirects ?? 'global',
          settingSendCookies: settings.cookies?.send ?? true,
          settingStoreCookies: settings.cookies?.store ?? true,
          settingRebuildPath: settings.rebuildPath ?? true,
        });
      } else if ('reflectionApi' in item || meta.id?.startsWith('greq')) {
        resources.push({
          ...common,
          _id: idFor(meta, 'greq'),
          _type: 'grpc_request',
          url: item.url || '',
          protoFileId: item.protoFileId,
          protoMethodName: item.protoMethodName || '',
          metadata: item.metadata || [],
          body: item.body || { text: '{}' },
        });
      } else if (!('eventListeners' in item) && !meta.id?.startsWith('socketio-req')) {
        const settings = item.settings || {};
        const url = item.url || '';
        const params = segmentParams(url, item.pathParameters);
        resources.push({
          ...common,
          _id: idFor(meta, 'ws-req'),
          _type: 'websocket_request',
          url,
          headers,
          parameters: item.parameters || [],
          authentication: hasAuth(authentication) ? [authentication] : [],
          ...(params ? { segmentParams: params } : {}),
          settingEncodeUrl: settings.encodeUrl ?? true,
          settingFollowRedirects: settings.followRedirects ?? 'global',
          settingSendCookies: settings.cookies?.send ?? true,
          settingStoreCookies: settings.cookies?.store ?? true,
        });
      }
    }
  };
  if (file.type !== ENVIRONMENTS) {
    walk(file.collection, workspaceId, {}, [], { preRequest: [], afterResponse: [] });
  }

  if (specContents) {
    resources.push({
      _id: idFor(spec.meta, 'spc'),
      _type: 'api_spec',
      parentId: workspaceId,
      fileName: file.name || '',
      contentType: 'yaml',
      contents: YAML.stringify(specContents),
    });
  }

  for (const suite of (file.type === ENVIRONMENTS ? [] : file.testSuites || [])) {
    const suiteId = idFor(suite.meta, 'uts');
    resources.push({
      _id: suiteId,
      _type: 'unit_test_suite',
      parentId: workspaceId,
      name: suite.name || '',
      metaSortKey: suite.meta?.sortKey ?? 0,
    });
    for (const test of suite.tests || []) {
      resources.push({
        _id: idFor(test.meta, 'ut'),
        _type: 'unit_test',
        parentId: suiteId,
        name: test.name || '',
        code: test.code || '',
        requestId: test.requestId || null,
        metaSortKey: test.meta?.sortKey ?? 0,
      });
    }
  }

  return resources as ImportRequest[];
};
