import fs from 'fs';
import tls from 'tls';

let systemCertificates: string[] | undefined;

// The OS trust store, read once: it can hold a corporate root that the
// bundled roots lack. tls.getCACertificates needs Node 22.15+.
export const getSystemCertificates = () => {
  if (!systemCertificates) {
    try {
      const { getCACertificates } = tls as { getCACertificates?: (type: 'system') => string[] };
      systemCertificates = getCACertificates?.('system') || [];
    } catch (err) {
      console.warn('[network] Could not read the system certificates', err);
      systemCertificates = [];
    }
  }
  return systemCertificates;
};

/**
 * The CAs a request trusts: the bundled roots, the system's when the setting
 * is on, and the workspace's own CA added to them rather than replacing them,
 * so public hosts keep working.
 */
export const getCaBundle = async (caCertificatePath: string | null, useSystemCertificates = false) => {
  const certificates = [...tls.rootCertificates, ...(useSystemCertificates ? getSystemCertificates() : [])];
  if (caCertificatePath) {
    certificates.push((await fs.promises.readFile(caCertificatePath)).toString());
  }
  return certificates.join('\n');
};
