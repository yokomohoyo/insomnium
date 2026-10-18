import Ajv from 'ajv';
import YAML from 'yaml';

// JSON Schema checks on a response: against a schema given with the
// assertion, or the response schema of the matching operation in the
// workspace's API spec.
//
// A schema can come with an imported or synced collection, so its own regular
// expressions (pattern, patternProperties) are left out: a crafted pattern
// could hang the app, which is why assertions have no regex operator either.
// Formats aren't checked.

type Json = unknown;

// The schema without regular expressions, and with OpenAPI 3.0's nullable as
// a type JSON Schema knows
const prepared = (schema: Json): Json => {
  if (Array.isArray(schema)) {
    return schema.map(prepared);
  }
  if (!schema || typeof schema !== 'object') {
    return schema;
  }
  const result: Record<string, Json> = {};
  const source = schema as Record<string, Json>;
  for (const [key, value] of Object.entries(source)) {
    if (key === 'pattern' && typeof value === 'string') {
      continue;
    }
    if (key === 'patternProperties') {
      // what the patterns allowed is then allowed to any name
      if (source.additionalProperties === false) {
        result.additionalProperties = true;
      }
      continue;
    }
    if (key === 'additionalProperties' && value === false && 'patternProperties' in source) {
      continue;
    }
    result[key] = prepared(value);
  }
  if (result.nullable === true && typeof result.type === 'string') {
    result.type = [result.type, 'null'];
  }
  return result;
};

const newAjv = () => new Ajv({ strict: false, allErrors: true, validateFormats: false, validateSchema: false });

// The ways the data doesn't match: none when it does
export const schemaErrors = (schema: Json, data: Json): string[] => {
  const validate = newAjv().compile(prepared(schema) as object);
  return validate(data) ? [] : describe(validate.errors);
};

const describe = (errors: Ajv['errors']) => (errors || []).map(({ instancePath, message }) => `${instancePath || 'the value'} ${message || 'is not valid'}`);

const pointer = (...parts: string[]) => `#/${parts.map(part => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// the base path of each of the spec's servers (OpenAPI 3) or its basePath (Swagger 2)
const basePaths = (spec: Record<string, any>): string[] => {
  if (spec.swagger) {
    return [typeof spec.basePath === 'string' ? spec.basePath.replace(/\/$/, '') : ''];
  }
  const servers: { url?: string; variables?: Record<string, { default?: string }> }[] = Array.isArray(spec.servers) && spec.servers.length ? spec.servers : [{ url: '/' }];
  return servers.map(({ url = '/', variables = {} }) => {
    const filled = url.replace(/{([^}]+)}/g, (_match, name) => variables[name]?.default ?? '');
    try {
      return new URL(filled, 'http://localhost').pathname.replace(/\/$/, '');
    } catch {
      return '';
    }
  });
};

export interface SpecOperation {
  // e.g. GET /pets/{id} 200
  label: string;
  // a JSON pointer to the response's schema in the spec
  schemaPointer: string;
}

// The operation a request was for, and the schema the spec gives its
// response: by method, path (under one of the servers) and status code
export const findSpecOperation = (specText: string, method: string, url: string, statusCode: number): SpecOperation | { error: string } => {
  let spec: Record<string, any>;
  try {
    spec = YAML.parse(specText);
  } catch {
    return { error: "the workspace's API spec can't be read" };
  }
  if (!spec || typeof spec !== 'object' || !spec.paths) {
    return { error: 'the workspace has no API spec with paths' };
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return { error: `can't read the URL ${url}` };
  }
  const lowerMethod = method.toLowerCase();
  // templates with fewer parameters first, so /pets/mine wins over /pets/{id}
  const templates = Object.keys(spec.paths).sort((a, b) => (a.match(/{/g) || []).length - (b.match(/{/g) || []).length);
  for (const base of basePaths(spec)) {
    if (!pathname.startsWith(base)) {
      continue;
    }
    const path = pathname.slice(base.length) || '/';
    for (const template of templates) {
      const matches = new RegExp(`^${escapeRegExp(template).replace(/\\{[^}]*\\}/g, '[^/]+')}/?$`).test(path);
      const operation = matches ? spec.paths[template]?.[lowerMethod] : undefined;
      if (!operation) {
        continue;
      }
      const label = `${method.toUpperCase()} ${template} ${statusCode}`;
      const responses = operation.responses || {};
      const code = [String(statusCode), `${String(statusCode)[0]}XX`, `${String(statusCode)[0]}xx`, 'default'].find(key => key in responses);
      if (!code) {
        return { error: `the spec has no ${statusCode} response for ${method.toUpperCase()} ${template}` };
      }
      if (spec.swagger) {
        return responses[code].schema ? { label, schemaPointer: pointer('paths', template, lowerMethod, 'responses', code, 'schema') } : { error: `the spec gives no schema for ${label}` };
      }
      const content = responses[code].content || {};
      const mediaType = Object.keys(content).find(type => /json/i.test(type));
      if (!mediaType || !content[mediaType].schema) {
        return { error: `the spec gives no JSON schema for ${label}` };
      }
      return { label, schemaPointer: pointer('paths', template, lowerMethod, 'responses', code, 'content', mediaType, 'schema') };
    }
  }
  return { error: `the spec has no operation for ${method.toUpperCase()} ${pathname}` };
};

// The ways the data doesn't match the schema the spec points at, whose
// references ($ref) are resolved in the spec
export const specSchemaErrors = (specText: string, schemaPointer: string, data: Json): string[] => {
  const ajv = newAjv();
  ajv.addSchema(prepared(YAML.parse(specText)) as object, 'spec');
  const validate = ajv.compile({ $ref: `spec${schemaPointer}` });
  return validate(data) ? [] : describe(validate.errors);
};
