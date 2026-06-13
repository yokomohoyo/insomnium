import aws4 from 'aws4';
import clone from 'clone';
import { parse as urlParse } from 'url';

import { AUTH_AWS_IAM, CONTENT_TYPE_FORM_DATA } from '../../common/constants';
import {
  getContentTypeHeader,
  getHostHeader,
  hasAcceptEncodingHeader,
  hasAcceptHeader,
  hasContentTypeHeader,
} from '../../common/misc';
import { getAuthStrategies } from '../../models/request';
import { assertSafeHeaders } from '../../network/header-injection';
import { DEFAULT_BOUNDARY } from './multipart';

// Special header value that will prevent the header being sent
const DISABLE_HEADER_VALUE = '__Di$aB13d__';
interface Input {
  req: Req;
  finalUrl: string;
  requestBody?: string;
  requestBodyPath?: string;
}
interface Req {
  headers: any;
  method: string;
  body: { mimeType?: string | null };
  authentication: any;
}
export const parseHeaderStrings = ({ req, finalUrl, requestBody, requestBodyPath }: Input) => {
  const headers = clone(req.headers);

  // Disable Expect and Transfer-Encoding headers when we have POST body/file
  const hasRequestBodyOrFilePath = requestBody !== undefined || requestBodyPath;
  if (hasRequestBodyOrFilePath) {
    headers.push({ name: 'Expect', value: DISABLE_HEADER_VALUE });
    headers.push({ name: 'Transfer-Encoding', value: DISABLE_HEADER_VALUE });
  }
  const { method } = req;
  const strategies = getAuthStrategies(req.authentication).filter(s => !s.disabled);
  // Apply AWS_IAM signatures inline; one strategy per AWS_IAM entry.
  for (const s of strategies) {
    if (s.type !== AUTH_AWS_IAM) continue;
    const hostHeader = getHostHeader(headers)?.value;
    const contentTypeHeader = getContentTypeHeader(headers)?.value;
    _getAwsAuthHeaders({
      authentication: s as any,
      url: finalUrl,
      hostHeader,
      contentTypeHeader,
      body: requestBody,
      method,
    }).forEach(header => headers.push(header));
  }
  const isMultipartForm = req.body.mimeType === CONTENT_TYPE_FORM_DATA;
  if (isMultipartForm && requestBodyPath) {
    const contentTypeHeader = getContentTypeHeader(headers);
    if (contentTypeHeader) {
      contentTypeHeader.value = `multipart/form-data; boundary=${DEFAULT_BOUNDARY}`;
    } else {
      headers.push({ name: 'Content-Type', value: `multipart/form-data; boundary=${DEFAULT_BOUNDARY}` });
    }
  }
  // Send a default Accept headers of anything
  if (!hasAcceptHeader(headers)) {
    headers.push({ name: 'Accept', value: '*/*' }); // Default to anything
  }

  // Don't auto-send Accept-Encoding header
  if (!hasAcceptEncodingHeader(headers)) {
    headers.push({ name: 'Accept-Encoding', value: DISABLE_HEADER_VALUE });
  }

  // Prevent curl from adding default content-type header
  if (!hasContentTypeHeader(headers)) {
    headers.push({ name: 'content-type', value: DISABLE_HEADER_VALUE });
  }

  const toSend = headers.filter((h: any) => h.name);
  // Validate the final set (incl. AWS-IAM headers added above, which the
  // network.ts guard never sees) so no CR/LF injects a curl header line.
  assertSafeHeaders(toSend);
  return toSend.map(({ name, value }: any) =>
    value === '' ? `${name};` // Curl needs a semicolon suffix to send empty header values
      : value === DISABLE_HEADER_VALUE ? `${name}:` // Tell Curl NOT to send the header if value is null
        : `${name}: ${value}`);
};

interface AWSOptions {
  authentication: {
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    region?: string;
    service?: string;
  };
  url: string;
  method: string;
  hostHeader?: string;
  contentTypeHeader?: string;
  body?: string;
}
export function _getAwsAuthHeaders({ authentication, url, method, hostHeader, contentTypeHeader, body }: AWSOptions): { name: string; value: any }[] {
  const { path, host } = urlParse(url);
  const onlyContentTypeHeader = contentTypeHeader ? { 'content-type': contentTypeHeader } : {};
  const { service, region, accessKeyId, secretAccessKey, sessionToken } = authentication;
  const signature = aws4.sign({
    service,
    region,
    body,
    method,
    headers: onlyContentTypeHeader,
    path: path || undefined,
    // AWS uses host header for signing so prioritize that if the user set it manually
    host: hostHeader || host || undefined,
  }, { accessKeyId, secretAccessKey, sessionToken });
  if (!signature.headers) {
    return [];
  }
  return Object.entries(signature.headers)
    .filter(([name]) => name !== 'content-type') // Don't add this because we already have it
    .map(([name, value]) => ({ name, value }));
}
