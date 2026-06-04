// Fetch .proto files from remote sources so users don't have to download +
// upload them by hand. Runs in the main process - no CORS, no preflight.
//
// Supported URL forms:
//   - github.com/<owner>/<repo>/blob/<ref>/<path>.proto       (single file)
//   - github.com/<owner>/<repo>/tree/<ref>[/<path>]           (recursive)
//   - raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>   (single file)
//   - <any-https>/<...>.proto                                  (single file)
//   - buf.build/<owner>/<repo>[:<ref>]                         (BSR module)

export interface FetchedProto {
  rootName: string;             // suggested display name (file or dir)
  isDirectory: boolean;         // true when files contains multiple entries
  files: FetchedProtoFile[];
}

export interface FetchedProtoFile {
  path: string;                 // relative path; '/' separators
  protoText: string;
}

// Optional auth tokens for private sources. Empty / missing = anonymous.
export interface ProtoFetchTokens {
  bufToken?: string;            // BSR personal token
  githubToken?: string;         // GitHub PAT (classic or fine-grained)
}

const PROTO_EXT = '.proto';
const GITHUB_BLOB_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+\.proto)$/i;
const GITHUB_TREE_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.+))?\/?$/i;
const RAW_GITHUB_RE = /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/.+\.proto$/i;
const BSR_RE = /^(?:https?:\/\/)?buf\.build\/([^/]+)\/([^/:?#]+)(?::([^/?#]+))?\/?$/i;
const HTTPS_PROTO_RE = /^https:\/\/.+\.proto$/i;

export type ProtoSourceKind = 'github-blob' | 'github-tree' | 'github-raw' | 'bsr' | 'https-raw';

export function classifyProtoUrl(input: string): { kind: ProtoSourceKind } | null {
  const url = input.trim();
  if (GITHUB_BLOB_RE.test(url)) return { kind: 'github-blob' };
  if (GITHUB_TREE_RE.test(url)) return { kind: 'github-tree' };
  if (RAW_GITHUB_RE.test(url)) return { kind: 'github-raw' };
  if (BSR_RE.test(url)) return { kind: 'bsr' };
  if (HTTPS_PROTO_RE.test(url)) return { kind: 'https-raw' };
  return null;
}

export async function fetchProto(url: string, tokens: ProtoFetchTokens = {}): Promise<FetchedProto> {
  const input = url.trim();
  const kind = classifyProtoUrl(input);
  if (!kind) {
    throw new Error(
      `Unrecognized proto source. Supported forms:\n` +
        `  github.com/<owner>/<repo>/blob/<ref>/<path>.proto\n` +
        `  github.com/<owner>/<repo>/tree/<ref>[/<path>]\n` +
        `  raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>.proto\n` +
        `  https://<host>/<path>.proto\n` +
        `  buf.build/<owner>/<repo>[:<ref>]`,
    );
  }
  switch (kind.kind) {
    case 'github-blob':   return fetchGithubBlob(input, tokens);
    case 'github-tree':   return fetchGithubTree(input, tokens);
    case 'github-raw':    return fetchHttpsSingle(input, githubHeaders(tokens));
    case 'bsr':           return fetchBsr(input, tokens);
    case 'https-raw':     return fetchHttpsSingle(input);
    default:              throw new Error(`Unhandled proto source kind: ${kind.kind}`);
  }
}

function githubHeaders(tokens: ProtoFetchTokens): Record<string, string> {
  return tokens.githubToken ? { Authorization: `Bearer ${tokens.githubToken}` } : {};
}

function bsrHeaders(tokens: ProtoFetchTokens): Record<string, string> {
  return tokens.bufToken ? { Authorization: `Bearer ${tokens.bufToken}` } : {};
}

// ----- GitHub ----------------------------------------------------------------

export function githubBlobToRawUrl(blobUrl: string): string {
  const m = blobUrl.match(GITHUB_BLOB_RE);
  if (!m) throw new Error(`Not a GitHub blob URL: ${blobUrl}`);
  const [, owner, repo, ref, path] = m;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

async function fetchGithubBlob(url: string, tokens: ProtoFetchTokens): Promise<FetchedProto> {
  const raw = githubBlobToRawUrl(url);
  const file = await fetchHttpsText(raw, githubHeaders(tokens));
  const name = url.split('/').pop()!;
  return { rootName: name, isDirectory: false, files: [{ path: name, protoText: file }] };
}

interface GhContentEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  download_url: string | null;
}

async function fetchGithubTree(url: string, tokens: ProtoFetchTokens): Promise<FetchedProto> {
  const m = url.match(GITHUB_TREE_RE);
  if (!m) throw new Error(`Not a GitHub tree URL: ${url}`);
  const [, owner, repo, ref, subPath = ''] = m;
  const rootName = subPath ? subPath.split('/').pop()! : repo;

  const headers = githubHeaders(tokens);
  const files: FetchedProtoFile[] = [];
  await walkGithubDir(owner, repo, ref, subPath, '', files, headers);
  if (files.length === 0) {
    throw new Error(`No .proto files found under ${url}`);
  }
  return { rootName, isDirectory: true, files };
}

async function walkGithubDir(
  owner: string,
  repo: string,
  ref: string,
  apiPath: string,        // path within the repo
  outPath: string,        // path within the output bundle
  out: FetchedProtoFile[],
  headers: Record<string, string>,
): Promise<void> {
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(apiPath)}?ref=${encodeURIComponent(ref)}`;
  const entries = await fetchJson<GhContentEntry[]>(api, { headers });
  for (const entry of entries) {
    if (entry.type === 'dir') {
      await walkGithubDir(owner, repo, ref, entry.path, joinPath(outPath, entry.name), out, headers);
    } else if (entry.type === 'file' && entry.name.endsWith(PROTO_EXT) && entry.download_url) {
      const protoText = await fetchHttpsText(entry.download_url, headers);
      out.push({ path: joinPath(outPath, entry.name), protoText });
    }
  }
}

// ----- Plain HTTPS -----------------------------------------------------------

async function fetchHttpsSingle(url: string, headers: Record<string, string> = {}): Promise<FetchedProto> {
  if (!url.endsWith(PROTO_EXT)) {
    throw new Error(`Expected a URL ending in .proto, got: ${url}`);
  }
  const protoText = await fetchHttpsText(url, headers);
  const name = url.split('/').pop()!;
  return { rootName: name, isDirectory: false, files: [{ path: name, protoText }] };
}

// ----- BSR -------------------------------------------------------------------

interface BsrDownloadResponse {
  module?: { files?: { path: string; content: string }[] };
}

async function fetchBsr(url: string, tokens: ProtoFetchTokens): Promise<FetchedProto> {
  const m = url.match(BSR_RE);
  if (!m) throw new Error(`Not a BSR reference: ${url}`);
  const [, owner, repo, ref = 'main'] = m;
  // BSR's Connect-RPC Download endpoint returns the module + transitive deps
  // as a single bundle. Public modules need no auth; private modules need a
  // user-scoped token from https://buf.build/settings/user.
  const endpoint = 'https://api.buf.build/buf.alpha.registry.v1alpha1.DownloadService/Download';
  const body: BsrDownloadResponse = await fetchJson(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bsrHeaders(tokens) },
    body: JSON.stringify({ owner, repository: repo, reference: ref }),
  });
  const rawFiles = body.module?.files ?? [];
  if (rawFiles.length === 0) {
    throw new Error(`BSR returned no files for ${owner}/${repo}@${ref}`);
  }
  const files: FetchedProtoFile[] = rawFiles
    .filter(f => f.path.endsWith(PROTO_EXT))
    .map(f => ({ path: f.path, protoText: decodeBase64(f.content) }));
  return { rootName: repo, isDirectory: files.length > 1, files };
}

function decodeBase64(s: string): string {
  return Buffer.from(s, 'base64').toString('utf-8');
}

// ----- Common ---------------------------------------------------------------

function joinPath(a: string, b: string): string {
  if (!a) return b;
  return `${a.replace(/\/+$/, '')}/${b}`;
}

async function fetchHttpsText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, Object.keys(headers).length ? { headers } : undefined);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`${init?.method || 'GET'} ${url}: ${res.status} ${res.statusText}${errText ? `\n${errText}` : ''}`);
  }
  return res.json() as Promise<T>;
}
