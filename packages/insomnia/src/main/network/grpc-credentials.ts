import { ChannelCredentials, credentials } from '@grpc/grpc-js';
import fs from 'fs';
import tls from 'tls';

import { AUTH_AWS_IAM, AUTH_DIGEST, AUTH_NETRC, AUTH_NTLM } from '../../common/constants';
import * as models from '../../models';
import { getAuthStrategies, RequestAuthentication } from '../../models/request';
import { urlMatchesCertHost } from '../../network/url-matches-cert-host';
import { findWorkspaceForRequest } from '../mcp/tools/util';
import { getCaBundle } from './ca-bundle';

/**
 * The channel credentials for a gRPC request, with the same trust as HTTP
 * requests: the bundled roots, the system store when that setting is on, the
 * workspace's CA, its client certificate for the host, and Validate
 * certificates. `url` is the host:port parseGrpcUrl gives.
 */
export const getGrpcCredentials = async (url: string, enableTls: boolean, parentId?: string | null): Promise<ChannelCredentials> => {
  if (!enableTls) {
    return credentials.createInsecure();
  }
  const settings = await models.settings.getOrCreate();
  const workspace = parentId ? await findWorkspaceForRequest(parentId) : null;
  const caCertificate = workspace ? await models.caCertificate.findByParentId(workspace._id) : null;
  const ca = await getCaBundle(caCertificate?.disabled === false ? caCertificate.path : null, settings.useSystemCertificates);
  const clientCertificate = workspace
    ? (await models.clientCertificate.findByParentId(workspace._id)).find(c => !c.disabled && urlMatchesCertHost(c.host, `https://${url}`))
    : undefined;
  // read as bytes: a PFX is binary
  const read = (filePath?: string | null) => filePath ? fs.promises.readFile(filePath) : undefined;
  const secureContext = tls.createSecureContext({
    ca,
    cert: await read(clientCertificate?.cert),
    key: await read(clientCertificate?.key),
    pfx: await read(clientCertificate?.pfx),
    passphrase: clientCertificate?.passphrase || undefined,
  });
  return credentials.createFromSecureContext(
    secureContext,
    settings.validateSSL ? {} : { rejectUnauthorized: false, checkServerIdentity: () => undefined },
  );
};

const CURL_ONLY_AUTH: Record<string, string> = {
  [AUTH_DIGEST]: 'Digest',
  [AUTH_NTLM]: 'NTLM',
  [AUTH_AWS_IAM]: 'AWS IAM',
  [AUTH_NETRC]: 'Netrc',
};

// These are applied by libcurl, which gRPC doesn't use, so a call with one
// would go out unauthenticated
export const assertGrpcAuthSupported = (authentication: RequestAuthentication) => {
  const strategy = getAuthStrategies(authentication).find(s => !s.disabled && s.type && CURL_ONLY_AUTH[s.type]);
  if (strategy) {
    throw new Error(`gRPC requests can't use ${CURL_ONLY_AUTH[strategy.type as string]} auth`);
  }
};
