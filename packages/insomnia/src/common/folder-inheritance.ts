import type { BaseModel } from '../models';
import { getAuthStrategies, type Request, type RequestHeader } from '../models/request';
import { isRequestGroup, type RequestGroup } from '../models/request-group';

const sameName = (a: Pick<RequestHeader, 'name'>, b: Pick<RequestHeader, 'name'>) =>
  (a.name || '').trim().toLowerCase() === (b.name || '').trim().toLowerCase();

// The headers a request's folders give it, outermost first: a nearer folder's
// header of the same name replaces an outer one's
export function inheritedHeaders(ancestors: BaseModel[]): (RequestHeader & { folder: string })[] {
  const folders = ancestors.filter(isRequestGroup) as RequestGroup[];
  const headers: (RequestHeader & { folder: string })[] = [];
  for (const folder of [...folders].reverse()) {
    for (const header of folder.headers || []) {
      if (header.disabled || !header.name?.trim()) {
        continue;
      }
      const index = headers.findIndex(inherited => sameName(inherited, header));
      if (index >= 0) {
        headers.splice(index, 1);
      }
      headers.push({ name: header.name, value: header.value, folder: folder.name });
    }
  }
  return headers;
}

// The nearest folder with auth, for a request that has none of its own
export function inheritedAuthFolder(ancestors: BaseModel[]): RequestGroup | undefined {
  return (ancestors.filter(isRequestGroup) as RequestGroup[]).find(folder => getAuthStrategies(folder.authentication).length);
}

// The request as it's sent: under its folders' headers (its own enabled ones
// win), and with the nearest folder's auth when it has none. A "No auth"
// strategy is auth of its own, so it opts out. Ancestors are nearest first.
export function withFolderSettings<T extends Pick<Request, 'headers' | 'authentication'>>(request: T, ancestors: BaseModel[]): T {
  if (!ancestors.some(isRequestGroup)) {
    return request;
  }
  const own = request.headers || [];
  const headers = [
    ...inheritedHeaders(ancestors)
      .filter(header => !own.some(mine => !mine.disabled && sameName(mine, header)))
      .map(({ name, value }) => ({ name, value })),
    ...own,
  ];
  const authentication = getAuthStrategies(request.authentication).length
    ? request.authentication
    : inheritedAuthFolder(ancestors)?.authentication ?? request.authentication;
  return { ...request, headers, authentication };
}
