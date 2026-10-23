// Documentation for an API, from its OpenAPI 3 description, as one Markdown
// file or one HTML page with nothing to load, to put in a repo or host anywhere.
// The export dialog makes it from a design document's spec, or from a
// collection's requests by way of export-openapi.ts (openApiOfExport): folders
// are its sections, descriptions its text, and saved examples its responses.
// Descriptions are Markdown; in the page, their raw HTML is shown as text and
// only http(s), mailto and in-page links are kept, so a spec can't run script.
import { marked } from 'marked';

import { openApiOfExport } from './openapi-client';

type Doc = Record<string, any>;

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
const isObject = (value: unknown): value is Doc => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

interface Row {
  name: string;
  type: string;
  required: boolean;
  description: string;
}
interface Content {
  type: string;
  rows: Row[];
  example?: string;
  exampleLanguage: string;
}
interface Operation {
  anchor: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  deprecated: boolean;
  servers: string[];
  security: string[] | null;
  parameters: (Row & { in: string; example: string })[];
  requestBody: { required: boolean; description: string; contents: Content[] } | null;
  responses: { status: string; description: string; contents: Content[] }[];
}
interface Section {
  anchor: string;
  name: string;
  description: string;
  operations: Operation[];
}
interface Schema {
  anchor: string;
  name: string;
  description: string;
  type: string;
  rows: Row[];
  json: string;
}
export interface DocsModel {
  title: string;
  version: string;
  description: string;
  servers: { url: string; description: string }[];
  securitySchemes: { name: string; description: string }[];
  sections: Section[];
  schemas: Schema[];
}

// a heading's anchor: lowercase words, unique in the page
const anchors = () => {
  const taken = new Set<string>();
  return (text: string) => {
    const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
    let anchor = base;
    for (let count = 2; taken.has(anchor); count++) {
      anchor = `${base}-${count}`;
    }
    taken.add(anchor);
    return anchor;
  };
};

export function docsModel(spec: Doc): DocsModel {
  const anchor = anchors();
  const schemas: Doc = isObject(spec.components?.schemas) ? spec.components.schemas : {};

  // a local $ref, followed: #/components/parameters/limit and the like
  const resolve = (value: unknown, depth = 0): any => {
    if (!isObject(value) || typeof value.$ref !== 'string' || !value.$ref.startsWith('#/') || depth > 8) {
      return value;
    }
    const target = value.$ref.slice(2).split('/').reduce<any>((node, part) => (isObject(node) ? node[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), spec);
    return target === undefined ? {} : resolve(target, depth + 1);
  };
  const refName = (schema: Doc) => /^#\/components\/schemas\/(.+)$/.exec(text(schema.$ref))?.[1].replace(/~1/g, '/').replace(/~0/g, '~');

  // a schema's type, in words: "array of Pet", "string (date-time)"
  const typeOf = (schema: unknown, depth = 0): string => {
    if (!isObject(schema) || depth > 6) {
      return 'any';
    }
    const named = refName(schema);
    if (named) {
      return named;
    }
    if (schema.$ref) {
      return typeOf(resolve(schema), depth + 1);
    }
    const nullable = schema.nullable === true ? ', nullable' : '';
    if (Array.isArray(schema.enum) && schema.enum.length) {
      return `one of ${schema.enum.map(value => JSON.stringify(value)).join(', ')}${nullable}`;
    }
    for (const [key, joiner] of [['allOf', ' and '], ['oneOf', ' or '], ['anyOf', ' or ']] as const) {
      if (Array.isArray(schema[key]) && schema[key].length) {
        return schema[key].map((part: unknown) => typeOf(part, depth + 1)).join(joiner) + nullable;
      }
    }
    if (Array.isArray(schema.type)) {
      return schema.type.join(' or ');
    }
    if (schema.type === 'array') {
      return `array of ${typeOf(schema.items, depth + 1)}${nullable}`;
    }
    const type = text(schema.type) || (isObject(schema.properties) ? 'object' : 'any');
    return `${type}${schema.format ? ` (${schema.format})` : ''}${nullable}`;
  };

  // an object schema's properties, with allOf's parts merged in
  const rowsOf = (schema: unknown, depth = 0): Row[] => {
    const resolved = resolve(schema);
    if (!isObject(resolved) || depth > 4) {
      return [];
    }
    const merged = Array.isArray(resolved.allOf) ? resolved.allOf.flatMap((part: unknown) => rowsOf(part, depth + 1)) : [];
    const required = new Set(Array.isArray(resolved.required) ? resolved.required : []);
    const own = Object.entries(isObject(resolved.properties) ? resolved.properties : {}).map(([name, property]) => ({
      name,
      type: typeOf(property),
      required: required.has(name),
      description: text(resolve(property)?.description),
    }));
    // a property declared again (in a later part, or its own) is the later one, in the first one's place
    const byName = new Map<string, Row>();
    for (const row of [...merged.map((row: Row) => ({ ...row, required: row.required || required.has(row.name) })), ...own]) {
      byName.set(row.name, row);
    }
    return [...byName.values()];
  };

  // a value like the schema's, for an example where the spec gives none
  const sampleOf = (schema: unknown, depth = 0): unknown => {
    const resolved = resolve(schema);
    if (!isObject(resolved) || depth > 6) {
      return null;
    }
    for (const key of ['example', 'default', 'const']) {
      if (resolved[key] !== undefined) {
        return resolved[key];
      }
    }
    if (Array.isArray(resolved.enum) && resolved.enum.length) {
      return resolved.enum[0];
    }
    if (Array.isArray(resolved.allOf) && resolved.allOf.length) {
      return Object.assign({}, ...resolved.allOf.map((part: unknown) => sampleOf(part, depth + 1)).filter(isObject));
    }
    const alternatives = resolved.oneOf || resolved.anyOf;
    if (Array.isArray(alternatives) && alternatives.length) {
      return sampleOf(alternatives[0], depth + 1);
    }
    const type = Array.isArray(resolved.type) ? resolved.type[0] : resolved.type;
    if (type === 'array') {
      return [sampleOf(resolved.items, depth + 1)];
    }
    if (type === 'object' || isObject(resolved.properties)) {
      return Object.fromEntries(Object.entries(isObject(resolved.properties) ? resolved.properties : {}).map(([name, property]) => [name, sampleOf(property, depth + 1)]));
    }
    if (type === 'integer' || type === 'number') {
      return 0;
    }
    if (type === 'boolean') {
      return true;
    }
    if (type === 'string') {
      return ({ 'date-time': '2026-01-01T00:00:00Z', date: '2026-01-01', uuid: '00000000-0000-0000-0000-000000000000', email: 'name@example.com', uri: 'https://example.com' } as Record<string, string>)[resolved.format] ?? 'string';
    }
    return null;
  };

  const contentsOf = (content: unknown): Content[] => Object.entries(isObject(content) ? content : {}).map(([type, rawMedia]) => {
    const media = isObject(rawMedia) ? rawMedia : {};
    const named = isObject(media.examples) ? Object.values(media.examples).map(example => resolve(example)).find(example => isObject(example) && example.value !== undefined) : undefined;
    const value = media.example !== undefined ? media.example : named ? named.value : media.schema ? sampleOf(media.schema) : undefined;
    const json = /json/i.test(type);
    return {
      type,
      rows: rowsOf(media.schema),
      ...(value === undefined || value === null && !json ? {} : { example: typeof value === 'string' && !json ? value : JSON.stringify(value, null, 2) }),
      exampleLanguage: json ? 'json' : /xml/i.test(type) ? 'xml' : '',
    };
  });

  const serverUrl = (server: Doc) => text(server.url).replace(/\{([^}]+)\}/g, (whole, name) => String(server.variables?.[name]?.default || whole));
  const securityOf = (security: unknown) => (Array.isArray(security)
    ? security.filter(isObject).map(requirement => Object.entries(requirement).map(([name, scopes]) => (Array.isArray(scopes) && scopes.length ? `${name} (${scopes.join(', ')})` : name)).join(' + '))
    : null);

  // sections in the order of the spec's tags, then of first use; untagged requests last
  const sectionOf = new Map<string, Section>();
  const tagInfo = new Map<string, string>((Array.isArray(spec.tags) ? spec.tags : []).filter(isObject).map(tag => [text(tag.name), text(tag.description)]));
  for (const name of tagInfo.keys()) {
    sectionOf.set(name, { anchor: '', name, description: tagInfo.get(name) || '', operations: [] });
  }
  const untagged: Section = { anchor: '', name: 'Requests', description: '', operations: [] };

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
      const parameters = new Map<string, Doc>();
      for (const raw of [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]) {
        const parameter = resolve(raw);
        if (isObject(parameter) && typeof parameter.name === 'string') {
          parameters.set(`${parameter.in}:${parameter.name}`, parameter);
        }
      }
      const requestBody = resolve(operation.requestBody);
      const summary = text(operation.summary) || `${method.toUpperCase()} ${path}`;
      const servers = Array.isArray(operation.servers) ? operation.servers : Array.isArray(item.servers) ? item.servers : [];
      const tag = Array.isArray(operation.tags) && typeof operation.tags[0] === 'string' ? operation.tags[0] : '';
      const section = tag ? sectionOf.get(tag) || sectionOf.set(tag, { anchor: '', name: tag, description: '', operations: [] }).get(tag)! : untagged;
      section.operations.push({
        anchor: '',
        method: method.toUpperCase(),
        path,
        summary,
        description: text(operation.description),
        deprecated: operation.deprecated === true,
        servers: servers.filter(isObject).map(serverUrl),
        security: securityOf(operation.security ?? spec.security),
        parameters: [...parameters.values()].map(parameter => ({
          name: parameter.name,
          in: text(parameter.in),
          type: typeOf(parameter.schema),
          required: parameter.in === 'path' || parameter.required === true,
          description: text(parameter.description),
          example: parameter.example !== undefined ? String(parameter.example) : parameter.schema?.example !== undefined ? String(parameter.schema.example) : '',
        })),
        requestBody: isObject(requestBody) && isObject(requestBody.content)
          ? { required: requestBody.required === true, description: text(requestBody.description), contents: contentsOf(requestBody.content) }
          : null,
        responses: Object.entries(isObject(operation.responses) ? operation.responses : {}).map(([status, rawResponse]) => {
          const response = resolve(rawResponse);
          return { status, description: text(response?.description), contents: contentsOf(response?.content) };
        }),
      });
    }
  }

  // anchors in reading order, so the first of a name keeps the plain one
  const sections = [...sectionOf.values(), untagged].filter(section => section.operations.length);
  for (const section of sections) {
    section.anchor = anchor(section.name);
    for (const operation of section.operations) {
      operation.anchor = anchor(`${operation.method} ${operation.summary}`);
    }
  }

  const schemes: Doc = isObject(spec.components?.securitySchemes) ? spec.components.securitySchemes : {};
  const info = isObject(spec.info) ? spec.info : {};
  return {
    title: text(info.title) || 'API',
    version: text(info.version),
    description: text(info.description),
    servers: (Array.isArray(spec.servers) ? spec.servers : []).filter(isObject).map(server => ({ url: serverUrl(server), description: text(server.description) })),
    securitySchemes: Object.entries(schemes).map(([name, rawScheme]) => {
      const scheme = resolve(rawScheme) || {};
      const flows = Object.entries(isObject(scheme.flows) ? scheme.flows : {})
        .map(([flow, details]: [string, any]) => [flow, ...['authorizationUrl', 'tokenUrl'].filter(key => details?.[key]).map(key => `${key} ${details[key]}`)].join(', '));
      const description = scheme.type === 'http' ? `HTTP ${text(scheme.scheme) || 'auth'}${scheme.bearerFormat ? ` (${scheme.bearerFormat})` : ''}`
        : scheme.type === 'apiKey' ? `API key in the ${text(scheme.in)} "${text(scheme.name)}"`
          : scheme.type === 'oauth2' ? `OAuth 2: ${flows.join('; ') || 'no flows'}`
            : scheme.type === 'openIdConnect' ? `OpenID Connect: ${text(scheme.openIdConnectUrl)}`
              : text(scheme.type) || 'auth';
      return { name, description: [description, text(scheme.description)].filter(Boolean).join('. ') };
    }),
    sections,
    schemas: Object.entries(schemas).map(([name, schema]) => ({
      anchor: anchor(`schema ${name}`),
      name,
      description: text(resolve(schema)?.description),
      type: typeOf(resolve(schema)),
      rows: rowsOf(schema),
      json: JSON.stringify(schema, null, 2),
    })),
  };
}

// Markdown

// text in a table cell: on one line, its pipes escaped
const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || ' ';
// text in a heading or inline: no line breaks
const inline = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
// a fenced block that its text can't close
const fence = (body: string, language = '') => {
  const ticks = '`'.repeat(Math.max(3, ...(body.match(/`+/g) || []).map(run => run.length + 1)));
  return `${ticks}${language}\n${body}\n${ticks}`;
};
const code = (value: string) => {
  const ticks = '`'.repeat(Math.max(1, ...(value.match(/`+/g) || []).map(run => run.length + 1)));
  return `${ticks}${value.includes('`') ? ` ${value} ` : value}${ticks}`;
};

const rowsTable = (rows: Row[]) => [
  '| Name | Type | Required | Description |',
  '| --- | --- | --- | --- |',
  ...rows.map(row => `| ${cell(code(row.name))} | ${cell(row.type)} | ${row.required ? 'yes' : 'no'} | ${cell(row.description)} |`),
].join('\n');

const contentsMarkdown = (contents: Content[]) => contents.flatMap(content => [
  `${code(content.type)}`,
  ...(content.rows.length ? [rowsTable(content.rows)] : []),
  ...(content.example !== undefined ? [fence(content.example, content.exampleLanguage)] : []),
]);

export function toMarkdownDocs(spec: Doc): string {
  const model = docsModel(spec);
  const out: string[] = [`# ${inline(model.title)}${model.version ? ` ${inline(model.version)}` : ''}`];
  if (model.description) {
    out.push(model.description);
  }
  if (model.servers.length) {
    out.push('## Servers', model.servers.map(server => `- ${code(server.url)}${server.description ? ` ${inline(server.description)}` : ''}`).join('\n'));
  }
  if (model.securitySchemes.length) {
    out.push('## Authentication', model.securitySchemes.map(scheme => `- **${inline(scheme.name)}**: ${inline(scheme.description)}`).join('\n'));
  }
  out.push('## Contents', [
    ...model.sections.flatMap(section => [
      `- [${inline(section.name)}](#${section.anchor})`,
      ...section.operations.map(operation => `  - [${operation.method} ${inline(operation.summary)}](#${operation.anchor})`),
    ]),
    ...(model.schemas.length ? ['- [Schemas](#schemas)'] : []),
  ].join('\n'));

  for (const section of model.sections) {
    out.push(`<a id="${section.anchor}"></a>\n\n## ${inline(section.name)}`);
    if (section.description) {
      out.push(section.description);
    }
    for (const operation of section.operations) {
      out.push(`<a id="${operation.anchor}"></a>\n\n### ${operation.method} ${inline(operation.summary)}`, code(`${operation.method} ${operation.path}`));
      if (operation.deprecated) {
        out.push('> **Deprecated**');
      }
      if (operation.description) {
        out.push(operation.description);
      }
      if (operation.servers.length) {
        out.push(`Server: ${operation.servers.map(code).join(', ')}`);
      }
      if (operation.security) {
        out.push(`Authentication: ${operation.security.length ? operation.security.map(inline).join(' or ') : 'none'}`);
      }
      if (operation.parameters.length) {
        out.push('#### Parameters', [
          '| Name | In | Type | Required | Description | Example |',
          '| --- | --- | --- | --- | --- | --- |',
          ...operation.parameters.map(row => `| ${cell(code(row.name))} | ${row.in} | ${cell(row.type)} | ${row.required ? 'yes' : 'no'} | ${cell(row.description)} | ${row.example ? cell(code(row.example)) : ' '} |`),
        ].join('\n'));
      }
      if (operation.requestBody) {
        out.push(`#### Request body${operation.requestBody.required ? ' (required)' : ''}`);
        if (operation.requestBody.description) {
          out.push(operation.requestBody.description);
        }
        out.push(...contentsMarkdown(operation.requestBody.contents));
      }
      if (operation.responses.length) {
        out.push('#### Responses');
        for (const response of operation.responses) {
          out.push(`**${inline(response.status)}**${response.description ? ` ${inline(response.description)}` : ''}`, ...contentsMarkdown(response.contents));
        }
      }
    }
  }

  if (model.schemas.length) {
    out.push('<a id="schemas"></a>\n\n## Schemas');
    for (const schema of model.schemas) {
      out.push(`<a id="${schema.anchor}"></a>\n\n### ${inline(schema.name)}`, `Type: ${inline(schema.type)}`);
      if (schema.description) {
        out.push(schema.description);
      }
      out.push(...(schema.rows.length ? [rowsTable(schema.rows)] : []), fence(schema.json, 'json'));
    }
  }
  return `${out.join('\n\n')}\n`;
}

// HTML

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
// only links that can't run script: the web, mail, and the page's own anchors
const safeHref = (href: string | null) => (href && /^(https?:|mailto:|#)/i.test(href.trim()) ? href.trim() : null);

class SafeRenderer extends marked.Renderer {
  html(html: string) {
    return escapeHtml(html);
  }
  link(href: string | null, title: string | null, linkText: string) {
    const safe = safeHref(href);
    return safe ? `<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ''} rel="noopener noreferrer">${linkText}</a>` : linkText;
  }
  image(href: string | null, title: string | null, altText: string) {
    const safe = safeHref(href);
    return safe && !safe.startsWith('mailto:') ? `<img src="${escapeHtml(safe)}" alt="${escapeHtml(altText)}"${title ? ` title="${escapeHtml(title)}"` : ''}>` : escapeHtml(altText);
  }
}

// the renderer goes in each parse's options, not marked.use() or setOptions:
// that leaves the app's marked setup (markdown-to-html.ts) alone, and use()
// would copy only an object's own keys, skipping a class's methods
const prose = (value: string) => (value
  ? `<div class="prose">${marked.parse(value, { gfm: true, mangle: false, headerIds: false, renderer: new SafeRenderer() })}</div>`
  : '');

const rowsHtml = (rows: Row[]) => `<table><thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead><tbody>${rows.map(row =>
  `<tr><td><code>${escapeHtml(row.name)}</code></td><td>${escapeHtml(row.type)}</td><td>${row.required ? 'yes' : 'no'}</td><td>${escapeHtml(row.description)}</td></tr>`).join('')}</tbody></table>`;

const contentsHtml = (contents: Content[]) => contents.map(content => [
  `<p class="media"><code>${escapeHtml(content.type)}</code></p>`,
  content.rows.length ? rowsHtml(content.rows) : '',
  content.example !== undefined ? `<pre><code>${escapeHtml(content.example)}</code></pre>` : '',
].join('')).join('');

const STYLE = `
:root{--bg:#fff;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--panel:#f6f8fa;--accent:#7e43c1;--get:#1a7f37;--post:#9a6700;--put:#0969da;--patch:#8250df;--delete:#cf222e;--other:#59636e}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--line:#3d444d;--panel:#151b23;--accent:#b688f0;--get:#3fb950;--post:#d29922;--put:#4493f8;--patch:#ab7df8;--delete:#f85149;--other:#9198a1}}
*{box-sizing:border-box}html{scroll-padding-top:16px}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--accent)}code,pre{font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.layout{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:100vh}
nav{position:sticky;top:0;height:100vh;overflow:auto;padding:24px 16px;border-right:1px solid var(--line);background:var(--panel)}
nav a{display:block;text-decoration:none;color:var(--fg);padding:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
nav .section{margin-top:14px;font-weight:600}nav .op{padding-left:8px;font-size:14px}
main{padding:32px 40px;max-width:1000px}
h1{margin-top:0}h2{margin-top:48px;padding-bottom:6px;border-bottom:1px solid var(--line)}h3{margin-top:36px}h4{margin:20px 0 8px;color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.04em}
.method{display:inline-block;min-width:64px;padding:1px 8px;margin-right:8px;border-radius:4px;color:#fff;font:600 12px/20px ui-monospace,Menlo,Consolas,monospace;text-align:center;vertical-align:middle;background:var(--other)}
.GET{background:var(--get)}.POST{background:var(--post)}.PUT{background:var(--put)}.PATCH{background:var(--patch)}.DELETE{background:var(--delete)}
.path{font-size:14px;color:var(--muted)}.deprecated{color:var(--delete);font-weight:600}.meta{color:var(--muted)}
table{border-collapse:collapse;width:100%;margin:8px 0 12px;font-size:14px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}th{background:var(--panel)}
pre{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:12px;overflow:auto}
.media{margin:12px 0 4px}.status{font-weight:600}details summary{cursor:pointer;color:var(--muted)}
.prose img{max-width:100%}
@media (max-width:800px){.layout{display:block}nav{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}main{padding:24px 16px}}
`;

export function toHtmlDocs(spec: Doc): string {
  const model = docsModel(spec);
  const title = `${model.title}${model.version ? ` ${model.version}` : ''}`;
  const nav = [
    ...model.sections.flatMap(section => [
      `<a class="section" href="#${section.anchor}">${escapeHtml(section.name)}</a>`,
      ...section.operations.map(operation => `<a class="op" href="#${operation.anchor}">${escapeHtml(`${operation.method} ${operation.summary}`)}</a>`),
    ]),
    ...(model.schemas.length ? ['<a class="section" href="#schemas">Schemas</a>'] : []),
  ].join('\n');

  const body: string[] = [`<h1>${escapeHtml(title)}</h1>`, prose(model.description)];
  if (model.servers.length) {
    body.push('<h2>Servers</h2>', `<ul>${model.servers.map(server => `<li><code>${escapeHtml(server.url)}</code>${server.description ? ` <span class="meta">${escapeHtml(server.description)}</span>` : ''}</li>`).join('')}</ul>`);
  }
  if (model.securitySchemes.length) {
    body.push('<h2>Authentication</h2>', `<ul>${model.securitySchemes.map(scheme => `<li><strong>${escapeHtml(scheme.name)}</strong>: ${escapeHtml(scheme.description)}</li>`).join('')}</ul>`);
  }
  for (const section of model.sections) {
    body.push(`<h2 id="${section.anchor}">${escapeHtml(section.name)}</h2>`, prose(section.description));
    for (const operation of section.operations) {
      body.push(
        `<h3 id="${operation.anchor}"><span class="method ${operation.method}">${operation.method}</span>${escapeHtml(operation.summary)}</h3>`,
        `<p class="path"><code>${escapeHtml(`${operation.method} ${operation.path}`)}</code></p>`,
        operation.deprecated ? '<p class="deprecated">Deprecated</p>' : '',
        prose(operation.description),
        operation.servers.length ? `<p class="meta">Server: ${operation.servers.map(server => `<code>${escapeHtml(server)}</code>`).join(', ')}</p>` : '',
        operation.security ? `<p class="meta">Authentication: ${operation.security.length ? escapeHtml(operation.security.join(' or ')) : 'none'}</p>` : '',
      );
      if (operation.parameters.length) {
        body.push('<h4>Parameters</h4>', `<table><thead><tr><th>Name</th><th>In</th><th>Type</th><th>Required</th><th>Description</th><th>Example</th></tr></thead><tbody>${operation.parameters.map(row =>
          `<tr><td><code>${escapeHtml(row.name)}</code></td><td>${escapeHtml(row.in)}</td><td>${escapeHtml(row.type)}</td><td>${row.required ? 'yes' : 'no'}</td><td>${escapeHtml(row.description)}</td><td>${row.example ? `<code>${escapeHtml(row.example)}</code>` : ''}</td></tr>`).join('')}</tbody></table>`);
      }
      if (operation.requestBody) {
        body.push(`<h4>Request body${operation.requestBody.required ? ' (required)' : ''}</h4>`, prose(operation.requestBody.description), contentsHtml(operation.requestBody.contents));
      }
      if (operation.responses.length) {
        body.push('<h4>Responses</h4>', ...operation.responses.map(response =>
          `<p><span class="status">${escapeHtml(response.status)}</span> ${escapeHtml(response.description)}</p>${contentsHtml(response.contents)}`));
      }
    }
  }
  if (model.schemas.length) {
    body.push('<h2 id="schemas">Schemas</h2>', ...model.schemas.map(schema => [
      `<h3 id="${schema.anchor}">${escapeHtml(schema.name)}</h3>`,
      `<p class="meta">Type: ${escapeHtml(schema.type)}</p>`,
      prose(schema.description),
      schema.rows.length ? rowsHtml(schema.rows) : '',
      `<details><summary>JSON schema</summary><pre><code>${escapeHtml(schema.json)}</code></pre></details>`,
    ].join('')));
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Insomnium">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="layout">
<nav>
<a href="#top"><strong>${escapeHtml(title)}</strong></a>
${nav}
</nav>
<main id="top">
${body.filter(Boolean).join('\n')}
</main>
</div>
</body>
</html>
`;
}

// The docs for an export (see openApiOfExport)
export const docsFromExport = (resources: Doc[], name: string, format: 'markdown' | 'html') =>
  (format === 'html' ? toHtmlDocs : toMarkdownDocs)(openApiOfExport(resources, name));
