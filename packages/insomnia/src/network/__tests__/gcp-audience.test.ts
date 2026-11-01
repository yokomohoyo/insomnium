import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { AUTH_GCP_ID_TOKEN } from '../../common/constants';
import { getAuthHeader, setGcpAudienceApproval } from '../authentication';
import { getGcpIdToken } from '../gcp-id-token/get-token';

jest.mock('../gcp-id-token/get-token', () => ({
  ...jest.requireActual<object>('../gcp-id-token/get-token'),
  getGcpIdToken: jest.fn(),
}));

const send = (audience: string, url: string) => getAuthHeader({ url, method: 'GET', authentication: { type: AUTH_GCP_ID_TOKEN, audience } } as any, url);

describe('a Google ID token', () => {
  beforeEach(() => {
    jest.mocked(getGcpIdToken).mockImplementation(async ({ audience }) => `token-for-${audience}`);
  });
  afterEach(() => setGcpAudienceApproval(() => true));

  it("is minted for the request's own origin without asking", async () => {
    const approve = jest.fn(() => false);
    setGcpAudienceApproval(approve);

    await expect(send('', 'https://svc-abc.a.run.app/items')).resolves.toEqual({ name: 'Authorization', value: 'Bearer token-for-https://svc-abc.a.run.app' });
    await expect(send('https://svc-abc.a.run.app/', 'https://svc-abc.a.run.app/items')).resolves.toBeTruthy();
    expect(approve).not.toHaveBeenCalled();
  });

  it('for another audience, only when that is approved', async () => {
    const approve = jest.fn(() => false);
    setGcpAudienceApproval(approve);

    await expect(send('https://internal.a.run.app', 'https://evil.example.com/')).rejects.toThrow('Not sending a Google ID token for https://internal.a.run.app to https://evil.example.com');
    expect(approve).toHaveBeenCalledWith({ audience: 'https://internal.a.run.app', origin: 'https://evil.example.com' });

    setGcpAudienceApproval(() => true);
    await expect(send('1234.apps.googleusercontent.com', 'https://iap.example.com/')).resolves.toEqual({ name: 'Authorization', value: 'Bearer token-for-1234.apps.googleusercontent.com' });
  });
});
