import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../../../__jest__/before-each';
import * as renderUtils from '../../../../common/render';
import * as models from '../../../../models';
import { getGcpIdToken, setGcpAudienceApproval } from '../../../../network/gcp-id-token/get-token';
import { localTemplateTags } from '../local-template-tags';

jest.mock('electron');
jest.mock('../../../../network/gcp-id-token/get-token', () => ({
  ...jest.requireActual<object>('../../../../network/gcp-id-token/get-token'),
  getGcpIdToken: jest.fn(),
}));

const run = (name: string, ...args: unknown[]) => {
  const tag = localTemplateTags.find(({ templateTag }) => templateTag.name === name);
  // @ts-expect-error the tags only use the context for requests and responses
  return tag!.templateTag.run({}, ...args);
};

describe('hmac', () => {
  it('signs with the key (RFC 4231 style vector)', () => {
    expect(run('hmac', 'sha256', 'hex', 'key', 'The quick brown fox jumps over the lazy dog'))
      .toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
    expect(run('hmac', 'sha1', 'base64', 'key', 'The quick brown fox jumps over the lazy dog'))
      .toBe('3nybhbi3iqa8ino29wqQcBydtNk=');
  });

  it('refuses an unknown algorithm or encoding', () => {
    expect(() => run('hmac', 'sha3', 'hex', 'k', 'v')).toThrow(/Invalid algorithm/);
    expect(() => run('hmac', 'sha256', 'latin1', 'k', 'v')).toThrow(/Invalid encoding/);
  });
});

describe('jwt', () => {
  afterEach(() => jest.useRealTimers());

  it('signs the claims (the jwt.io example)', () => {
    expect(run('jwt', 'HS256', '{"sub":"1234567890","name":"John Doe","iat":1516239022}', 'your-256-bit-secret', 0))
      .toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  });

  it('adds iat and exp when it expires, without overriding claims that set them', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const claims = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

    expect(claims(run('jwt', 'HS512', '{"sub":"a"}', 's', 60))).toEqual({ iat: 1767225600, exp: 1767225660, sub: 'a' });
    expect(claims(run('jwt', 'HS384', '{"exp":5}', 's', 60)).exp).toBe(5);
  });

  it('refuses a payload that is not a JSON object', () => {
    expect(() => run('jwt', 'HS256', 'not json', 's', 0)).toThrow(/JSON object/);
    expect(() => run('jwt', 'HS256', '[1]', 's', 0)).toThrow(/JSON object/);
    expect(() => run('jwt', 'RS256', '{}', 's', 0)).toThrow(/Invalid algorithm/);
  });
});

describe('random', () => {
  it('makes integers within the range, both ends included', () => {
    const values = new Set(Array.from({ length: 200 }, () => run('random', 'integer', 1, 3)));
    expect([...values].sort()).toEqual(['1', '2', '3']);
    expect(run('random', 'integer', 7, 7)).toBe('7');
  });

  it('makes strings of the length asked for', () => {
    expect(run('random', 'alphanumeric', 0, 0, 24)).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(run('random', 'hex', 0, 0, 7)).toMatch(/^[0-9a-f]{7}$/);
  });

  it('picks booleans and choices', () => {
    expect(['true', 'false']).toContain(run('random', 'boolean'));
    expect(['red', 'green']).toContain(run('random', 'choice', 0, 0, 0, ' red, ,green '));
  });

  it('refuses ranges and lengths that make no sense', () => {
    expect(() => run('random', 'integer', 5, 1)).toThrow(/minimum/);
    expect(() => run('random', 'alphanumeric', 0, 0, 0)).toThrow(/length/);
    expect(() => run('random', 'hex', 0, 0, 5000)).toThrow(/length/);
    expect(() => run('random', 'choice', 0, 0, 0, ' , ')).toThrow(/at least one choice/);
  });
});

describe('faker', () => {
  it('generates the value named, as Postman and Kong Insomnia name them', async () => {
    expect(await run('faker', 'guid')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await run('faker', 'randomEmail')).toMatch(/@/);
    expect(await run('faker')).toMatch(/\w+ \w+/);
  });

  it('offers every name, and refuses one it does not have', async () => {
    const tag = localTemplateTags.find(({ templateTag }) => templateTag.name === 'faker');
    expect(tag?.templateTag.args?.[0].options?.map(({ value }) => value)).toContain('randomFullName');
    await expect(run('faker', 'randomNope')).rejects.toThrow('Unknown faker value "randomNope"');
    await expect(run('faker', 'constructor')).rejects.toThrow(/Unknown faker value/);
  });
});

describe('env', () => {
  beforeEach(globalBeforeEach);
  afterEach(() => {
    delete process.env.INSOMNIUM_TAG_TEST;
  });

  it('reads a variable once Preferences allow it', async () => {
    process.env.INSOMNIUM_TAG_TEST = 'v4lue';
    await expect(run('env', 'INSOMNIUM_TAG_TEST')).rejects.toThrow(/isn't an allowed environment variable/);
    await models.settings.patch({ allowedEnvironmentVariables: 'INSOMNIUM_TAG_*' });
    expect(await run('env', ' INSOMNIUM_TAG_TEST ')).toBe('v4lue');
  });
});

describe('now', () => {
  afterEach(() => jest.useRealTimers());

  it('shifts the time by the offset', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(run('now', 'iso-8601', '', '+1d')).toBe('2026-01-02T00:00:00.000Z');
    expect(run('now', 'unix', '', '-30m')).toBe(String(1767225600 - 1800));
    expect(run('now', 'iso-8601')).toBe('2026-01-01T00:00:00.000Z');
  });

  it('refuses an offset it cannot read', () => {
    expect(() => run('now', 'iso-8601', '', 'tomorrow')).toThrow(/Invalid offset/);
  });
});

describe('the tags in a template', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
  });

  it('take their arguments in order', async () => {
    expect(await renderUtils.render("{% hmac 'sha256', 'hex', 'key', 'The quick brown fox jumps over the lazy dog' %}"))
      .toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
    expect(await renderUtils.render("{% random 'choice', 0, 1000, 16, 'only' %}")).toBe('only');
  });
});

describe('gcpIdToken', () => {
  const tag = localTemplateTags.find(({ templateTag }) => templateTag.name === 'gcpIdToken')!.templateTag;
  const mint = (audience: string, url: string, renderPurpose = 'send') => tag.run({
    renderPurpose,
    meta: { requestId: 'req_1' },
    util: {
      render: async (value: string) => value,
      models: { request: { getById: async () => ({ _id: 'req_1', url }) } },
    },
  } as any, audience, 'adc', '');

  beforeEach(() => {
    jest.mocked(getGcpIdToken).mockImplementation(async ({ audience }) => `token-for-${audience}`);
  });
  afterEach(() => setGcpAudienceApproval(() => true));

  it("mints for the request's own origin without asking", async () => {
    const approve = jest.fn(() => false);
    setGcpAudienceApproval(approve);

    await expect(mint('https://svc-abc.a.run.app', 'https://svc-abc.a.run.app/items', 'general')).resolves.toBe('token-for-https://svc-abc.a.run.app');
    expect(approve).not.toHaveBeenCalled();
  });

  it('for another audience, only on a send that is approved', async () => {
    const approve = jest.fn(() => false);
    setGcpAudienceApproval(approve);

    await expect(mint('https://internal.a.run.app', 'https://evil.example.com/', 'general')).rejects.toThrow('minted only when the request is sent');
    expect(approve).not.toHaveBeenCalled();
    await expect(mint('https://internal.a.run.app', 'https://evil.example.com/')).rejects.toThrow('Not sending a Google ID token for https://internal.a.run.app to https://evil.example.com');
    expect(approve).toHaveBeenCalledWith({ audience: 'https://internal.a.run.app', origin: 'https://evil.example.com' });
    expect(getGcpIdToken).not.toHaveBeenCalled();

    setGcpAudienceApproval(() => true);
    await expect(mint('1234.apps.googleusercontent.com', 'https://iap.example.com/')).resolves.toBe('token-for-1234.apps.googleusercontent.com');
  });
});
