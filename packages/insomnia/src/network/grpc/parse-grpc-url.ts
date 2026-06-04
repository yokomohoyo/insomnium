export const parseGrpcUrl = (grpcUrl: string): { url: string; enableTls: boolean } => {
  if (!grpcUrl) {
    return { url: '', enableTls: false };
  }
  const lower = grpcUrl.toLowerCase();
  if (lower.startsWith('grpc://')) {
    return { url: lower.slice(7), enableTls: false };
  }
  if (lower.startsWith('grpcs://')) {
    return { url: lower.slice(8), enableTls: true };
  }
  // No scheme: infer TLS from common conventions — port 443, *.run.app
  // (Cloud Run), or *.googleapis.com. Avoids silent plaintext on hosts that
  // require TLS.
  const inferTls =
    /:443(\/|$)/.test(lower) ||
    /\.run\.app(:\d+)?$/.test(lower) ||
    /\.googleapis\.com(:\d+)?$/.test(lower);
  return { url: lower, enableTls: inferTls };
};
