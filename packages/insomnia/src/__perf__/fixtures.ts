// Large, reproducible inputs for the benchmarks (*.bench.ts) and for trying
// the app by hand (npm run perf:fixtures). Deterministic: the same options
// give the same output, ids included.

export interface CollectionOptions {
  // folders at each level, and how deep they nest
  folders?: number;
  depth?: number;
  requestsPerFolder?: number;
  // variables in the base environment, and sub environments
  envVars?: number;
  subEnvironments?: number;
}

export interface ExportResource {
  _id: string;
  _type: 'workspace' | 'request_group' | 'request' | 'environment';
  parentId: string | null;
  name: string;
  [key: string]: unknown;
}

// the model type of each export _type, for seeding the database directly
export const MODEL_TYPES: Record<ExportResource['_type'], string> = {
  workspace: 'Workspace',
  request_group: 'RequestGroup',
  request: 'Request',
  environment: 'Environment',
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** An Insomnium v4 export of one collection, the shape import_collection and Import take. */
export function largeCollection({
  folders = 10,
  depth = 1,
  requestsPerFolder = 100,
  envVars = 50,
  subEnvironments = 3,
}: CollectionOptions = {}) {
  const resources: ExportResource[] = [];
  const created = 1_700_000_000_000;
  const workspaceId = 'wrk_perf';
  resources.push({ _id: workspaceId, _type: 'workspace', parentId: null, name: `Perf ${folders}x${depth}x${requestsPerFolder}`, scope: 'collection', created, modified: created });

  const base: Record<string, unknown> = { baseUrl: 'http://localhost:4010' };
  for (let i = 0; i < envVars; i++) {
    base[`var${i}`] = i % 3 === 0 ? { nested: { value: `v${i}`, list: [i, i + 1] } } : `value ${i}`;
  }
  resources.push({ _id: 'env_perf_base', _type: 'environment', parentId: workspaceId, name: 'Base Environment', data: base, created, modified: created });
  for (let s = 0; s < subEnvironments; s++) {
    resources.push({ _id: `env_perf_${s}`, _type: 'environment', parentId: 'env_perf_base', name: `Sub ${s}`, data: { var0: `sub ${s}` }, metaSortKey: s, created, modified: created });
  }

  let n = 0;
  const addRequests = (parentId: string, path: string) => {
    for (let r = 0; r < requestsPerFolder; r++, n++) {
      const method = METHODS[n % METHODS.length];
      resources.push({
        _id: `req_perf_${n}`,
        _type: 'request',
        parentId,
        name: `${method} ${path}/item ${r}`,
        method,
        url: `{{ _.baseUrl }}/echo${path}/${r}?q={{ _.var1 }}`,
        headers: [{ name: 'Accept', value: 'application/json' }, { name: 'X-Trace', value: `{{ _.var${n % Math.max(envVars, 1)} }}` }],
        body: method === 'GET' || method === 'DELETE' ? {} : { mimeType: 'application/json', text: JSON.stringify({ id: n, name: `item ${r}`, path }) },
        parameters: [],
        authentication: {},
        description: `Request ${n} in ${path}`,
        metaSortKey: r,
        created: created + n,
        modified: created + n,
      });
    }
  };
  const addFolders = (parentId: string, level: number, path: string) => {
    for (let f = 0; f < folders; f++) {
      const id = `fld_perf_${path.replace(/\//g, '_')}_${f}`;
      const folderPath = `${path}/f${f}`;
      resources.push({ _id: id, _type: 'request_group', parentId, name: `Folder ${folderPath}`, metaSortKey: f, created, modified: created });
      if (level < depth) {
        addFolders(id, level + 1, folderPath);
      }
      addRequests(id, folderPath);
    }
  };
  addFolders(workspaceId, 1, '');

  return {
    _type: 'export',
    __export_format: 4,
    __export_date: new Date(created).toISOString(),
    __export_source: 'insomnium.perf-fixtures',
    resources,
  };
}

/** A JSON body of about `bytes` bytes: an array of records, some non-ASCII. */
export function largeJson(bytes: number) {
  const items: string[] = [];
  let size = 12;
  for (let i = 0; size < bytes; i++) {
    const item = JSON.stringify({
      id: i,
      name: `item ${i}`,
      email: `user${i}@example.com`,
      tags: ['alpha', 'beta', 'gamma'],
      nested: { score: i * 1.5, active: i % 2 === 0, note: 'café ☃ \\u00e9' },
    });
    size += item.length + 1;
    items.push(item);
  }
  return `{"items":[${items.join(',')}]}`;
}

/** An OpenAPI 3 document with `paths` paths (two operations and a schema each), as JSON or YAML. */
export function largeOpenApi(paths: number, format: 'json' | 'yaml' = 'json') {
  const spec = {
    openapi: '3.0.3',
    info: { title: `Perf ${paths}`, version: '1.0.0', description: 'Generated for benchmarks', contact: { email: 'perf@example.com' } },
    servers: [{ url: 'http://localhost:4010' }],
    tags: [{ name: 'things', description: 'Things' }],
    paths: {} as Record<string, unknown>,
    components: { schemas: {} as Record<string, unknown> },
  };
  for (let i = 0; i < paths; i++) {
    spec.components.schemas[`Thing${i}`] = {
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
    };
    const id = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
    const thing = { 'application/json': { schema: { $ref: `#/components/schemas/Thing${i}` } } };
    spec.paths[`/things${i}/{id}`] = {
      get: { operationId: `getThing${i}`, tags: ['things'], summary: `Get thing ${i}`, description: 'Gets it', parameters: [id], responses: { 200: { description: 'OK', content: thing } } },
      put: { operationId: `putThing${i}`, tags: ['things'], summary: `Put thing ${i}`, description: 'Puts it', parameters: [id], requestBody: { content: thing }, responses: { 200: { description: 'OK' } } },
    };
  }
  return format === 'json' ? JSON.stringify(spec, null, 2) : toYaml(spec).trimStart() + '\n';
}

/** An event stream body: `events` events of about `bytesPerEvent` data each. */
export function largeEventStream(events: number, bytesPerEvent = 200) {
  const lines: string[] = [];
  for (let i = 0; i < events; i++) {
    lines.push(`id: ${i}`, 'event: tick', `data: ${JSON.stringify({ i, pad: 'x'.repeat(Math.max(0, bytesPerEvent - 20)) })}`, '');
  }
  return lines.join('\n') + '\n';
}

// enough YAML for the spec above: maps, lists and scalars
function toYaml(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    return value.map(item => `\n${indent}- ${toYaml(item, indent + '  ').trimStart()}`).join('');
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => {
      const nested = item !== null && typeof item === 'object';
      return `\n${indent}${JSON.stringify(key)}:${nested ? toYaml(item, indent + '  ') : ` ${JSON.stringify(item)}`}`;
    }).join('');
  }
  return ` ${JSON.stringify(value)}`;
}
