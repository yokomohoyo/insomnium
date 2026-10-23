// A TypeScript client for an API, from its OpenAPI 3 description: a type for
// each schema, and a function for each operation, over fetch, with no
// dependencies. The export dialog makes one from a design document's spec, or
// from a collection's requests by way of export-openapi.ts.
import { parseApiSpec } from './api-specs';
import { toOpenApi } from './export-openapi';

type Doc = Record<string, any>;

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
const isObject = (value: unknown): value is Doc => !!value && typeof value === 'object' && !Array.isArray(value);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const RESERVED = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'await']);

const words = (text: string) => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
const pascal = (text: string) => words(text).map(word => word[0].toUpperCase() + word.slice(1)).join('') || 'Type';
const camel = (text: string) => {
  const name = pascal(text);
  return name[0].toLowerCase() + name.slice(1);
};
// a type's name: PascalCase, not starting with a digit
const typeName = (name: string) => {
  const named = pascal(name);
  return /^\d/.test(named) ? `T${named}` : named;
};
// an object key, quoted when it isn't an identifier
const key = (name: string) => (IDENTIFIER.test(name) ? name : JSON.stringify(name));
// reading a key from `request`
const access = (object: string, name: string) => (IDENTIFIER.test(name) ? `${object}.${name}` : `${object}[${JSON.stringify(name)}]`);
// a comment's text, so it can't end the comment
const commentText = (text: string) => text.replace(/\*\//g, '*\\/').trim();
// text for a // comment: on one line
const lineCommentText = (text: string) => commentText(text).replace(/[\r\n\u2028\u2029]+/g, ' ');
// text inside a template literal, as written: its backslashes, backticks and
// every $ escaped, so no ${ can form, even next to the substitutions
const templateText = (text: string) => text.replace(/[\\`$]/g, character => `\\${character}`);

const unique = (taken: Set<string>, name: string) => {
  let candidate = RESERVED.has(name) ? `${name}Operation` : name;
  for (let count = 2; taken.has(candidate); count++) {
    candidate = `${name}${count}`;
  }
  taken.add(candidate);
  return candidate;
};

export function typescriptClient(spec: Doc): string {
  const schemas: Doc = isObject(spec.components?.schemas) ? spec.components.schemas : {};
  const schemaNames = new Map<string, string>();
  const takenTypes = new Set(['ApiError', 'ClientOptions', 'Client']);
  for (const name of Object.keys(schemas)) {
    schemaNames.set(name, unique(takenTypes, typeName(name)));
  }

  // a local $ref, followed: #/components/parameters/limit and the like
  const resolve = (value: unknown, depth = 0): any => {
    if (!isObject(value) || typeof value.$ref !== 'string' || !value.$ref.startsWith('#/') || depth > 8) {
      return value;
    }
    const target = value.$ref.slice(2).split('/').reduce<any>((node, part) => (isObject(node) ? node[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), spec);
    return target === undefined ? {} : resolve(target, depth + 1);
  };

  const tsType = (schema: unknown, depth = 0): string => {
    if (!isObject(schema) || depth > 12) {
      return 'unknown';
    }
    if (typeof schema.$ref === 'string') {
      const match = /^#\/components\/schemas\/(.+)$/.exec(schema.$ref);
      const named = match && schemaNames.get(match[1].replace(/~1/g, '/').replace(/~0/g, '~'));
      return named || tsType(resolve(schema), depth + 1);
    }
    const nullable = schema.nullable === true ? ' | null' : '';
    if (Array.isArray(schema.allOf) && schema.allOf.length) {
      return `(${schema.allOf.map((part: unknown) => tsType(part, depth + 1)).join(' & ')})${nullable}`;
    }
    const alternatives = schema.oneOf || schema.anyOf;
    if (Array.isArray(alternatives) && alternatives.length) {
      return `(${alternatives.map((part: unknown) => tsType(part, depth + 1)).join(' | ')})${nullable}`;
    }
    if (Array.isArray(schema.enum) && schema.enum.length) {
      return `${schema.enum.map((value: unknown) => JSON.stringify(value)).join(' | ')}${nullable}`;
    }
    if (schema.const !== undefined) {
      return JSON.stringify(schema.const);
    }
    // OpenAPI 3.1 allows a list of types
    if (Array.isArray(schema.type)) {
      return schema.type.map((type: unknown) => tsType({ ...schema, type }, depth + 1)).join(' | ');
    }
    switch (schema.type) {
      case 'string':
        return (schema.format === 'binary' ? 'Blob' : 'string') + nullable;
      case 'integer':
      case 'number':
        return 'number' + nullable;
      case 'boolean':
        return 'boolean' + nullable;
      case 'null':
        return 'null';
      case 'array':
        return `Array<${tsType(schema.items, depth + 1)}>${nullable}`;
      default:
        break;
    }
    if (schema.type === 'object' || isObject(schema.properties) || schema.additionalProperties !== undefined) {
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      const lines = Object.entries(isObject(schema.properties) ? schema.properties : {}).map(([name, property]) => {
        const description = isObject(property) && typeof property.description === 'string' ? `/** ${commentText(property.description)} */ ` : '';
        return `${description}${key(name)}${required.has(name) ? '' : '?'}: ${tsType(property, depth + 1)};`;
      });
      if (schema.additionalProperties === true || (lines.length === 0 && schema.additionalProperties === undefined)) {
        lines.push('[key: string]: unknown;');
      } else if (isObject(schema.additionalProperties)) {
        lines.push(`[key: string]: ${lines.length ? 'unknown' : tsType(schema.additionalProperties, depth + 1)};`);
      }
      return `{ ${lines.join(' ')} }${nullable}`;
    }
    return 'unknown';
  };

  // the base URL: the first server's, with its variables' defaults
  const server = Array.isArray(spec.servers) && isObject(spec.servers[0]) ? spec.servers[0] : null;
  const baseUrl = server
    ? String(server.url || '').replace(/\{([^}]+)\}/g, (whole, name) => String(server.variables?.[name]?.default ?? whole))
    : '';

  const takenOperations = new Set<string>();
  const operations: string[] = [];
  for (const [path, rawItem] of Object.entries(isObject(spec.paths) ? spec.paths : {})) {
    const item = resolve(rawItem);
    if (!isObject(item)) {
      continue;
    }
    for (const method of METHODS) {
      const operation: unknown = item[method];
      if (!isObject(operation)) {
        continue;
      }
      const name = unique(takenOperations, camel(typeof operation.operationId === 'string' && operation.operationId ? operation.operationId : `${method} ${path.replace(/\{([^}]+)\}/g, 'by $1')}`));

      // the operation's parameters, over the path's, by name and place
      const parameters = new Map<string, Doc>();
      for (const raw of [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]) {
        const parameter = resolve(raw);
        if (isObject(parameter) && typeof parameter.name === 'string' && ['path', 'query', 'header'].includes(parameter.in)) {
          parameters.set(`${parameter.in}:${parameter.name}`, parameter);
        }
      }
      const fields: string[] = [];
      let anyRequired = false;
      for (const parameter of parameters.values()) {
        const required = parameter.in === 'path' || parameter.required === true;
        anyRequired ||= required;
        const description = typeof parameter.description === 'string' ? `/** ${commentText(parameter.description)} */ ` : '';
        fields.push(`${description}${key(parameter.name)}${required ? '' : '?'}: ${tsType(parameter.schema)};`);
      }

      const requestBody = resolve(operation.requestBody);
      const content = isObject(requestBody) && isObject(requestBody.content) ? requestBody.content : {};
      const contentType = Object.keys(content).find(type => /json/i.test(type)) || Object.keys(content)[0];
      const bodyKey = [...parameters.values()].some(parameter => parameter.name === 'body') ? 'requestBody' : 'body';
      let bodyKind = '';
      if (contentType) {
        const bodyRequired = requestBody.required === true;
        anyRequired ||= bodyRequired;
        let bodyType = 'string | Blob';
        if (/json/i.test(contentType)) {
          bodyKind = 'json';
          bodyType = tsType(content[contentType]?.schema);
        } else if (/x-www-form-urlencoded/i.test(contentType)) {
          bodyKind = 'form';
          bodyType = 'Record<string, string>';
        } else if (/multipart\/form-data/i.test(contentType)) {
          bodyKind = 'raw';
          bodyType = 'FormData';
        } else {
          bodyKind = 'raw';
        }
        fields.push(`${bodyKey}${bodyRequired ? '' : '?'}: ${bodyType};`);
      }

      // what a success answers with: the first 2xx response's JSON, if any
      const responses: Doc = isObject(operation.responses) ? operation.responses : {};
      const success: string | undefined = Object.keys(responses).filter(code => /^2(\d\d|XX)$/i.test(code)).sort()[0];
      const response: Doc | null = success ? resolve(responses[success]) : null;
      const responseContent: Doc = response && isObject(response.content) ? response.content : {};
      const jsonType = Object.keys(responseContent).find(type => /json/i.test(type));
      const result = jsonType ? tsType(responseContent[jsonType]?.schema) : Object.keys(responseContent).length ? 'string' : 'void';

      // the path's text as written, with each {parameter} it declares as its value
      const urlPath = path.split(/(\{[^}]+\})/).map(part => {
        const parameter = /^\{([^}]+)\}$/.exec(part);
        return parameter && parameters.has(`path:${parameter[1]}`)
          ? `\${encodeURIComponent(String(${access('request', parameter[1])}))}`
          : templateText(part);
      }).join('');
      const pick = (place: string) => [...parameters.values()].filter(parameter => parameter.in === place)
        .map(parameter => `${key(parameter.name)}: ${access('request', parameter.name)}`).join(', ');
      const query = pick('query');
      const headers = pick('header');
      const sendOptions = [
        query && `query: { ${query} }`,
        headers && `headers: { ${headers} }`,
        bodyKind && `body: ${access('request', bodyKey)}, kind: '${bodyKind}'`,
      ].filter(Boolean).join(', ');
      const hasRequest = fields.length > 0;
      const docs = [
        typeof operation.summary === 'string' ? commentText(operation.summary) : '',
        typeof operation.description === 'string' && operation.description !== operation.summary ? commentText(operation.description) : '',
        `${method.toUpperCase()} ${commentText(path)}`,
        operation.deprecated === true ? '@deprecated' : '',
      ].filter(Boolean);
      operations.push([
        '    /**',
        ...docs.flatMap(doc => doc.split('\n')).map(line => `     * ${line}`.trimEnd()),
        '     */',
        `    ${name}: (${hasRequest ? `request: { ${fields.join(' ')} }${anyRequired ? '' : ' = {}'}, ` : ''}init?: RequestInit): Promise<${result}> =>`,
        `      send<${result}>('${method.toUpperCase()}', \`${urlPath}\`, { ${sendOptions} }, init),`,
      ].join('\n'));
    }
  }

  const info = isObject(spec.info) ? spec.info : {};
  const title = [info.title, info.version].filter(value => typeof value === 'string' && value).join(' ') || 'the API';
  const types = Object.entries(schemas).map(([name, schema]) => {
    const description = isObject(schema) && typeof schema.description === 'string' ? `/** ${commentText(schema.description)} */\n` : '';
    return `${description}export type ${schemaNames.get(name)} = ${tsType(schema)};`;
  });

  return `// A client for ${lineCommentText(title)}, generated by Insomnium from its OpenAPI description.
// It uses fetch and has no dependencies:
//
//   const api = createClient({ baseUrl: 'https://api.example.com', headers: { Authorization: 'Bearer …' } });
//   const result = await api.someOperation({ id: '1' });
//
// A response that isn't 2xx throws an ApiError with its status and body.
/* eslint-disable */

${types.join('\n\n')}${types.length ? '\n\n' : ''}export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown, readonly response: Response) {
    super(\`\${response.url || 'The request'} answered \${status}\`);
    this.name = 'ApiError';
  }
}

export interface ClientOptions {
  // where the API is; the spec's first server by default
  baseUrl?: string;
  // sent with every request, such as Authorization
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  fetch?: typeof fetch;
}

type SendOptions = {
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  body?: unknown;
  kind?: 'json' | 'form' | 'raw';
};

export function createClient(options: ClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? ${JSON.stringify(baseUrl)}).replace(/\\/+$/, '');
  const send = async <T>(method: string, path: string, { query = {}, headers = {}, body, kind }: SendOptions, init?: RequestInit): Promise<T> => {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null) {
          search.append(name, String(item));
        }
      }
    }
    const extra = typeof options.headers === 'function' ? await options.headers() : options.headers;
    const sent = new Headers(extra);
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined && value !== null) {
        sent.set(name, String(value));
      }
    }
    let payload: BodyInit | undefined;
    if (body !== undefined) {
      if (kind === 'json') {
        sent.set('Content-Type', 'application/json');
        payload = JSON.stringify(body);
      } else if (kind === 'form') {
        payload = new URLSearchParams(body as Record<string, string>);
      } else {
        payload = body as BodyInit;
      }
    }
    const queryString = search.toString();
    const url = baseUrl + path + (queryString ? \`?\${queryString}\` : '');
    const response = await (options.fetch ?? fetch)(url, { ...init, method, headers: sent, body: payload });
    const text = await response.text();
    const data = text && /json/i.test(response.headers.get('content-type') || '') ? JSON.parse(text) : text;
    if (!response.ok) {
      throw new ApiError(response.status, data, response);
    }
    return (text ? data : undefined) as T;
  };

  return {
${operations.join('\n\n')}
  };
}

export type Client = ReturnType<typeof createClient>;
`;
}

// An export's API description: its design document's OpenAPI 3 spec when it
// has exactly one, or else one made from its HTTP requests
export function openApiOfExport(resources: Doc[], name: string): Doc {
  const specs = resources
    .filter(resource => resource._type === 'api_spec')
    .map(resource => {
      try {
        return parseApiSpec(String(resource.contents || ''));
      } catch {
        return null;
      }
    })
    .filter(parsed => parsed?.format === 'openapi' && /^3\./.test(parsed.formatVersion || '') && isObject(parsed.contents));
  const workspaces = resources.filter(resource => resource._type === 'workspace');
  return specs.length === 1 && workspaces.length === 1 ? specs[0]!.contents! : toOpenApi(resources as any, name);
}

// The client for an export
export const clientFromExport = (resources: Doc[], name: string) => typescriptClient(openApiOfExport(resources, name));
