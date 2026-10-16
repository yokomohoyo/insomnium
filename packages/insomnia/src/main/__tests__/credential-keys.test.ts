import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { announceCredentialStorage, credentialStorageNotices, safeStorageKeyWrapper } from '../credential-keys';

const mockWindow = { send: jest.fn() };
const mockStatus = jest.fn<() => { state: string; unreadableKeys: string[] }>();

jest.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ webContents: mockWindow }] },
  safeStorage: {
    encryptStringAsync: async (text: string) => Buffer.from(`v11${text}`),
    decryptStringAsync: async (data: Buffer) => ({ result: data.toString().slice(3), shouldReEncrypt: true }),
  },
}));
jest.mock('../../common/database', () => ({ credentialStorageStatus: () => mockStatus() }));

const platform = process.platform;
const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value });

describe('safeStorageKeyWrapper', () => {
  afterEach(() => {
    setPlatform(platform);
  });

  it('round-trips a key through safeStorage and passes on a re-encrypt request', async () => {
    const key = Buffer.from('0123456789abcdef0123456789abcdef');
    const unwrapped = await safeStorageKeyWrapper.unwrap(await safeStorageKeyWrapper.wrap(key));
    expect(unwrapped.key.equals(key)).toBe(true);
    expect(unwrapped.rewrap).toBe(true);
  });

  it('calls only Linux\'s built-in fallback (v10) weak', () => {
    const v10 = Buffer.from('v10xyz').toString('base64');
    setPlatform('linux');
    expect(safeStorageKeyWrapper.isWeak(v10)).toBe(true);
    expect(safeStorageKeyWrapper.isWeak(Buffer.from('v11xyz').toString('base64'))).toBe(false);
    setPlatform('darwin');
    expect(safeStorageKeyWrapper.isWeak(v10)).toBe(false);
  });
});

describe('credentialStorageNotices()', () => {
  afterEach(() => {
    delete process.env.SNAP;
  });
  const keys = (notices: { key: string }[]) => notices.map(notice => notice.key);

  it('says nothing when credentials are encrypted, or not saved yet', () => {
    expect(credentialStorageNotices({ state: 'ready', unreadableKeys: [] })).toEqual([]);
    expect(credentialStorageNotices({ state: 'none', unreadableKeys: [] })).toEqual([]);
  });

  it('warns about the weak fallback once, and tells snap users how to connect the keyring', () => {
    const [weak] = credentialStorageNotices({ state: 'weak', unreadableKeys: [] });
    expect(weak.key).toBe('credentials-weak');
    expect(weak.message).not.toContain('snap connect');
    process.env.SNAP = '/snap/insomnium/1';
    expect(credentialStorageNotices({ state: 'weak', unreadableKeys: [] })[0].message).toContain('snap connect insomnium:password-manager-service');
  });

  it.each(['locked', 'unavailable'] as const)('warns when %s on every launch: one key per launch', state => {
    const [first] = credentialStorageNotices({ state, unreadableKeys: [] });
    expect(first.key).toMatch(new RegExp(`^credentials-${state}-\\d+$`));
    expect(keys(credentialStorageNotices({ state, unreadableKeys: [] }))).toEqual([first.key]);
  });

  it('tells the user once about credentials it can no longer read, then about the weak fallback', () => {
    expect(keys(credentialStorageNotices({ state: 'weak', unreadableKeys: ['a1', 'b2'] }))).toEqual(['credentials-unreadable-a1-b2', 'credentials-weak']);
    expect(keys(credentialStorageNotices({ state: 'locked', unreadableKeys: ['a1'] }))).toEqual([expect.stringMatching(/^credentials-locked-/)]);
  });
});

describe('announceCredentialStorage()', () => {
  afterEach(() => {
    mockWindow.send.mockReset();
  });

  it('sends the notice to every window', () => {
    mockStatus.mockReturnValue({ state: 'unavailable', unreadableKeys: [] });
    announceCredentialStorage();
    expect(mockWindow.send).toHaveBeenCalledWith('show-notification', expect.objectContaining({ key: expect.stringMatching(/^credentials-unavailable-/) }));
  });

  it('sends nothing when there is nothing to say', () => {
    mockStatus.mockReturnValue({ state: 'ready', unreadableKeys: [] });
    announceCredentialStorage();
    expect(mockWindow.send).not.toHaveBeenCalled();
  });
});
