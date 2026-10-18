import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

const CA = '-----BEGIN CERTIFICATE-----\nMIIBcompanyroot\n-----END CERTIFICATE-----\n';

const load = () => {
  let bundle: typeof import('../ca-bundle') | undefined;
  jest.isolateModules(() => {
    bundle = require('../ca-bundle');
  });
  return bundle!;
};
const systemStore = (getCACertificates: (type: 'system') => string[]) =>
  jest.spyOn(tls as unknown as { getCACertificates: typeof getCACertificates }, 'getCACertificates').mockImplementation(getCACertificates);

describe('getCaBundle()', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is the bundled roots without a workspace CA', async () => {
    expect(await load().getCaBundle(null)).toBe(tls.rootCertificates.join('\n'));
  });

  it('adds a workspace CA to the bundled roots instead of replacing them', async () => {
    const caPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'insomnium-ca-')), 'ca.pem');
    fs.writeFileSync(caPath, CA);

    const bundle = await load().getCaBundle(caPath);

    expect(bundle.startsWith(tls.rootCertificates.join('\n'))).toBe(true);
    expect(bundle.endsWith(CA)).toBe(true);
  });

  it('adds the system store only when asked, and reads it once', async () => {
    const read = systemStore(() => ['SYSTEM ROOT']);
    const { getCaBundle } = load();

    expect(await getCaBundle(null)).not.toContain('SYSTEM ROOT');
    expect(await getCaBundle(null, true)).toContain('SYSTEM ROOT');
    await getCaBundle(null, true);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('falls back to the bundled roots when the system store cannot be read', async () => {
    systemStore(() => {
      throw new Error('no store');
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await load().getCaBundle(null, true)).toBe(tls.rootCertificates.join('\n'));
  });
});
