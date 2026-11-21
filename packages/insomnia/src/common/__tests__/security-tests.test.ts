/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import {
  PROBE_ORIGIN,
  type ProbeExchange,
  type ProbeVariant,
  RATE_LIMIT_REQUESTS,
  runSecurityTests,
  sameAnswer,
  SECURITY_TEST_MAX_REQUESTS,
  type SecurityTestInput,
} from '../security-tests';

const jwt = (header: object, payload: object, signature = 'c2lnbmF0dXJlLXNpZ25hdHVyZQ') =>
  `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
const TOKEN = jwt({ alg: 'HS256', typ: 'JWT' }, { sub: 'ana', exp: 4102444800 });

const ORDERS = JSON.stringify({ orders: [{ id: 7, item: 'kettle', price: 31, buyer: 'ana', address: '1 Hill Road' }], total: 1, page: 1 });
const answer = (statusCode: number, body = '', headers: [string, string][] = []): Omit<ProbeExchange, 'sent'> =>
  ({ statusCode, body, headers: headers.map(([name, value]) => ({ name, value })) });

// An API as a function of what it's sent: `api` sees each variant, with the
// headers the app would send for it
const run = async (
  api: (variant: ProbeVariant, sent: Map<string, string>) => Omit<ProbeExchange, 'sent'>,
  input: Partial<SecurityTestInput> & { sends?: Record<string, string>; otherSends?: Record<string, string> } = {},
) => {
  const { sends = { authorization: `Bearer ${TOKEN}` }, otherSends = { authorization: 'Bearer other' }, ...rest } = input;
  const variants: ProbeVariant[] = [];
  const result = await runSecurityTests({
    method: 'GET',
    url: 'https://api.example.com/orders',
    send: async variant => {
      variants.push(variant);
      const sent = new Map(Object.entries(variant.withoutCredentials ? {} : variant.asOther ? otherSends : sends));
      Object.entries(variant.headers || {}).forEach(([name, value]) => sent.set(name.toLowerCase(), value));
      return { ...api(variant, sent), sent };
    },
    ...rest,
  });
  const outcomes = Object.fromEntries(result.checks.map(({ id, outcome }) => [id, outcome]));
  return { ...result, outcomes, variants, ids: result.findings.map(({ id }) => id) };
};

// answers only the caller with the real token, over https, and limits its rate
const careful = (variant: ProbeVariant, sent: Map<string, string>) => {
  if (variant.url?.startsWith('http://')) {
    return answer(301, '', [['Location', 'https://api.example.com/orders']]);
  }
  return sent.get('authorization') === `Bearer ${TOKEN}`
    ? answer(200, ORDERS, [['RateLimit-Remaining', '99']])
    : answer(sent.has('authorization') ? 403 : 401, '{"error":"no"}');
};

describe('sameAnswer()', () => {
  const exchange = (statusCode: number, body: string): ProbeExchange => ({ statusCode, body, headers: [], sent: new Map() });

  it('is the same body, or one that differs by a timestamp', () => {
    expect(sameAnswer(exchange(200, ORDERS), exchange(200, ORDERS))).toBe(true);
    const at = (time: string) => exchange(200, JSON.stringify({ ...JSON.parse(ORDERS), at: time }));
    expect(sameAnswer(at('2026-11-21T10:00:00Z'), at('2026-11-21T10:00:07Z'))).toBe(true);
  });

  it("isn't another record, an error, or a short body that differs", () => {
    expect(sameAnswer(exchange(200, ORDERS), exchange(200, JSON.stringify({ orders: [{ id: 9, item: 'lamp', price: 12, buyer: 'ben', address: '4 Mill Lane' }], total: 1, page: 1 })))).toBe(false);
    expect(sameAnswer(exchange(200, ORDERS), exchange(401, ORDERS))).toBe(false);
    expect(sameAnswer(exchange(200, '{"ok":true}'), exchange(200, '{"ok":false}'))).toBe(false);
  });

  it('tells two empty answers apart by their status', () => {
    expect(sameAnswer(exchange(204, ''), exchange(204, ''))).toBe(true);
    expect(sameAnswer(exchange(204, ''), exchange(200, ''))).toBe(false);
  });
});

describe('runSecurityTests()', () => {
  it('finds nothing in a careful API, and says what each test saw', async () => {
    const { findings, outcomes, requests, checks } = await run(careful, { hasOther: true });

    expect(findings).toEqual([]);
    expect(outcomes).toEqual({
      'baseline': 'passed',
      'no-credentials': 'passed',
      'token-signature': 'passed',
      'token-unsigned': 'passed',
      'other-user': 'passed',
      'cors-any-origin': 'passed',
      'plain-http': 'passed',
      'quote-in-parameter': 'skipped',
      'rate-limit': 'passed',
    });
    expect(checks.find(({ id }) => id === 'no-credentials')?.note).toBe('It answered 401.');
    expect(checks.find(({ id }) => id === 'plain-http')?.note).toBe('It answered 301. It sends the caller on to somewhere else.');
    // (the request, then one for each test that sent)
    expect(requests).toBe(7);
  });

  it('never sends more than it says it may', async () => {
    const { requests } = await run(() => answer(200, ORDERS), { hasOther: true, url: 'https://api.example.com/orders?a=1&b=2&c=3&d=4' });

    expect(requests).toBe(SECURITY_TEST_MAX_REQUESTS);
  });

  it('only sends a GET or HEAD again', async () => {
    const { checks, requests } = await run(careful, { method: 'post' });

    expect(requests).toBe(0);
    expect(checks).toEqual([expect.objectContaining({ id: 'baseline', outcome: 'skipped', note: 'Only a GET or HEAD is sent again: a POST would change things once more for every test.' })]);
  });

  it('has nothing to compare with when the request itself fails', async () => {
    const refused = await run(() => answer(403, '{"error":"no"}'));
    expect(refused.requests).toBe(1);
    expect(refused.checks).toEqual([expect.objectContaining({ id: 'baseline', outcome: 'unclear', note: expect.stringContaining('It answered 403.') })]);

    const down = await run(() => ({ ...answer(0), error: 'Could not connect to server' }));
    expect(down.checks[0].note).toContain('Nothing came back (Could not connect to server).');
  });

  describe('without credentials', () => {
    it('says when the answer is the same', async () => {
      const { findings, variants } = await run((variant, sent) => variant.withoutCredentials && variant.url?.startsWith('https:') ? answer(200, ORDERS) : careful(variant, sent));

      expect(findings).toEqual([expect.objectContaining({ id: 'no-credentials', severity: 'high', owasp: 'API2:2023 Broken Authentication' })]);
      expect(variants).toContainEqual({ url: 'https://api.example.com/orders', withoutCredentials: true });
    });

    it("takes the URL's credentials out too", async () => {
      const { variants, outcomes } = await run(() => answer(200, ORDERS), { sends: {}, url: 'https://ana:hunter2@api.example.com/orders?api_key=s3cret&page=2' });

      expect(outcomes['no-credentials']).not.toBe('skipped');
      expect(variants.find(variant => variant.withoutCredentials && variant.url?.startsWith('https:'))?.url).toBe('https://api.example.com/orders?page=2');
    });

    it('leaves a different answer to be looked at', async () => {
      const { outcomes, findings } = await run((variant, sent) => variant.withoutCredentials && variant.url?.startsWith('https:') ? answer(200, '{"orders":[]}') : careful(variant, sent));

      expect(outcomes['no-credentials']).toBe('unclear');
      expect(findings).toEqual([]);
    });

    it("isn't tried for a request that sends none", async () => {
      const { outcomes } = await run(() => answer(200, ORDERS, [['RateLimit-Limit', '5']]), { sends: {} });

      expect(outcomes['no-credentials']).toBe('skipped');
      // (but one whose auth adds a key to the query does)
      expect((await run(() => answer(200, ORDERS), { sends: {}, credentialInQuery: true })).ids).toContain('no-credentials');
    });
  });

  describe('tokens', () => {
    // reads the token without verifying it
    const trusting = (_variant: ProbeVariant, sent: Map<string, string>) => /^Bearer eyJ/.test(sent.get('authorization') || '') ? answer(200, ORDERS, [['RateLimit-Limit', '5']]) : answer(401);

    it('says when a token with a wrong signature, or none, is accepted', async () => {
      const { findings, variants } = await run(trusting);

      expect(findings.map(({ id, severity }) => [id, severity])).toEqual([['token-signature', 'high'], ['token-unsigned', 'high']]);
      const sentTokens = variants.flatMap(({ headers }) => headers?.Authorization ? [headers.Authorization.replace('Bearer ', '')] : []);
      expect(sentTokens).toHaveLength(2);
      // the same token but for its signature
      expect(sentTokens[0].split('.').slice(0, 2)).toEqual(TOKEN.split('.').slice(0, 2));
      expect(sentTokens[0].split('.')[2]).not.toBe(TOKEN.split('.')[2]);
      expect(sentTokens[0].split('.')[2]).toHaveLength(TOKEN.split('.')[2].length);
      // and the same claims, said to be unsigned
      expect(JSON.parse(Buffer.from(sentTokens[1].split('.')[0], 'base64url').toString())).toEqual({ alg: 'none', typ: 'JWT' });
      expect(sentTokens[1].split('.').slice(1)).toEqual([TOKEN.split('.')[1], '']);
      // (the findings name where the token was, not the token)
      expect(JSON.stringify(findings)).not.toContain(TOKEN.split('.')[1]);
    });

    it("aren't tried for a token that isn't a JSON Web Token", async () => {
      const { outcomes } = await run(() => answer(200, ORDERS, [['RateLimit-Limit', '5']]), { sends: { authorization: 'Bearer opaque-token' } });

      expect(outcomes['token-signature']).toBe('skipped');
      expect(outcomes['token-unsigned']).toBe('skipped');
    });
  });

  describe('as another user', () => {
    const shared = () => answer(200, ORDERS, [['RateLimit-Limit', '5']]);

    it('says when they get the same answer', async () => {
      const { findings } = await run((_variant, sent) => sent.has('authorization') ? shared() : answer(401), { hasOther: true, sends: { authorization: 'Bearer opaque-ana' } });

      expect(findings).toEqual([expect.objectContaining({ id: 'other-user', severity: 'medium', owasp: 'API1:2023 Broken Object Level Authorization' })]);
    });

    it("isn't tried without another environment, or with one that sends the same credentials", async () => {
      expect((await run(shared, { sends: { authorization: 'Bearer opaque' } })).outcomes['other-user']).toBe('skipped');
      const same = await run(shared, { hasOther: true, sends: { authorization: 'Bearer opaque' }, otherSends: { authorization: 'Bearer opaque' } });
      expect(same.outcomes['other-user']).toBe('skipped');
      expect(same.checks.find(({ id }) => id === 'other-user')?.note).toBe('The other environment sends the same credentials as this one.');
    });

    it('passes when the other user is refused, and leaves their own answer to be looked at', async () => {
      const own = (variant: ProbeVariant, sent: Map<string, string>) => sent.get('authorization') === 'Bearer ana' ? shared() : sent.get('authorization') === 'Bearer other' ? answer(variant.asOther ? 404 : 200) : answer(401);
      expect((await run(own, { hasOther: true, sends: { authorization: 'Bearer ana' } })).outcomes['other-user']).toBe('passed');
      const different = (_variant: ProbeVariant, sent: Map<string, string>) => sent.get('authorization') === 'Bearer ana' ? shared() : sent.has('authorization') ? answer(200, '{"orders":[]}') : answer(401);
      expect((await run(different, { hasOther: true, sends: { authorization: 'Bearer ana' } })).outcomes['other-user']).toBe('unclear');
    });
  });

  it('says when CORS allows whichever origin asks, with credentials', async () => {
    const reflecting = (_variant: ProbeVariant, sent: Map<string, string>) => sent.get('authorization') === `Bearer ${TOKEN}`
      ? answer(200, ORDERS, [['RateLimit-Limit', '5'], ...(sent.has('origin') ? [['Access-Control-Allow-Origin', sent.get('origin')!], ['Access-Control-Allow-Credentials', 'true']] as [string, string][] : [])])
      : answer(401);
    const { findings, variants } = await run(reflecting);

    expect(variants).toContainEqual({ headers: { Origin: PROBE_ORIGIN } });
    expect(findings).toEqual([expect.objectContaining({ id: 'cors-any-origin', severity: 'high', owasp: 'API8:2023 Security Misconfiguration' })]);
    // (any origin without credentials is what a public API does)
    const open = (_variant: ProbeVariant, sent: Map<string, string>) => sent.get('authorization') === `Bearer ${TOKEN}` ? answer(200, ORDERS, [['RateLimit-Limit', '5'], ['Access-Control-Allow-Origin', sent.get('origin') || '*']]) : answer(401);
    expect((await run(open)).findings).toEqual([]);
  });

  describe('over plain http', () => {
    const both = (variant: ProbeVariant, sent: Map<string, string>) => variant.url?.startsWith('http://') ? answer(200, '{}') : careful(variant, sent);

    it('says when it answers, and sends no credentials to find out', async () => {
      const { findings, variants } = await run(both);

      expect(findings).toEqual([expect.objectContaining({ id: 'plain-http', severity: 'medium' })]);
      expect(variants).toContainEqual({ url: 'http://api.example.com/orders', withoutCredentials: true });
    });

    it("isn't tried on this computer, on a named port, or for a request already over http", async () => {
      for (const url of ['https://localhost/orders', 'https://api.example.com:8443/orders', 'http://api.example.com/orders']) {
        expect((await run(both, { url })).outcomes['plain-http']).toBe('skipped');
      }
    });
  });

  describe('with a quote in a parameter', () => {
    const url = 'https://api.example.com/orders?status=open&sort=date';
    const breaksOn = (param: string, broken: Omit<ProbeExchange, 'sent'>) => (variant: ProbeVariant, sent: Map<string, string>) =>
      variant.url && new URL(variant.url).searchParams.get(param)?.endsWith("'") ? broken : careful(variant, sent);

    it('says when it reaches the database', async () => {
      const { findings, variants } = await run(breaksOn('sort', answer(500, 'You have an error in your SQL syntax near \'date\'\'')), { url });

      expect(findings).toEqual([expect.objectContaining({ id: 'quote-in-parameter', severity: 'high', evidence: 'sort', title: 'A quote in a parameter reaches the database' })]);
      expect(variants.map(variant => variant.url)).toContain('https://api.example.com/orders?status=open%27&sort=date');
    });

    it('says when the server shows a stack trace, or just fails', async () => {
      const trace = await run(breaksOn('status', answer(400, 'Traceback (most recent call last):\n  File "app.py"')), { url });
      expect(trace.findings).toEqual([expect.objectContaining({ severity: 'medium', evidence: 'status', title: 'A quote in a parameter makes the server show a Python traceback' })]);
      const failed = await run(breaksOn('status', answer(500, '{"error":"Internal Server Error"}')), { url });
      expect(failed.findings).toEqual([expect.objectContaining({ severity: 'low', evidence: 'status' })]);
    });

    it('passes when the server takes it or refuses it', async () => {
      const { outcomes, checks } = await run(breaksOn('status', answer(400, '{"error":"bad status"}')), { url });

      expect(outcomes['quote-in-parameter']).toBe('passed');
      expect(checks.find(({ id }) => id === 'quote-in-parameter')?.note).toBe('With a quote added, it answered status: 400, sort: 200.');
    });
  });

  describe('several times in a row', () => {
    it('says when nothing shows a rate limit', async () => {
      const { findings, requests } = await run((variant, sent) => sent.get('authorization') === `Bearer ${TOKEN}` && !variant.url ? answer(200, ORDERS) : answer(401));

      expect(findings).toEqual([expect.objectContaining({ id: 'rate-limit', severity: 'low', owasp: 'API4:2023 Unrestricted Resource Consumption' })]);
      expect(requests).toBe(6 + RATE_LIMIT_REQUESTS);
    });

    it('stops at the first 429', async () => {
      let plain = 0;
      const { outcomes, checks } = await run((variant, sent) => {
        if (Object.keys(variant).length) {
          return careful(variant, sent).statusCode === 200 ? answer(200, ORDERS) : careful(variant, sent);
        }
        return ++plain > 4 ? answer(429) : answer(200, ORDERS);
      });

      expect(outcomes['rate-limit']).toBe('passed');
      expect(checks.find(({ id }) => id === 'rate-limit')?.note).toBe('It answered 429 to request 4.');
    });
  });

  it('goes on past a test that could not be sent, and stops when asked to', async () => {
    const failing = await run((variant, sent) => {
      if (variant.headers?.Origin) {
        throw new Error('refused by the request policy');
      }
      return careful(variant, sent);
    });
    expect(failing.checks.find(({ id }) => id === 'cors-any-origin')).toMatchObject({ outcome: 'unclear', note: 'It could not be sent: refused by the request policy' });
    expect(failing.outcomes['plain-http']).toBe('passed');

    const controller = new AbortController();
    const stopped = await run((variant, sent) => {
      if (variant.withoutCredentials) {
        controller.abort();
      }
      return careful(variant, sent);
    }, { signal: controller.signal });
    expect(stopped.requests).toBe(2);
    expect(stopped.outcomes).toMatchObject({ 'no-credentials': 'passed', 'token-signature': 'skipped', 'rate-limit': 'skipped' });
  });

  it('puts the most severe finding first', async () => {
    const { findings } = await run((variant, sent) => variant.url?.startsWith('http://') ? answer(200, '{}') : sent.has('authorization') || variant.withoutCredentials ? answer(200, ORDERS) : answer(401));

    expect(findings.map(({ severity }) => severity)).toEqual(['high', 'high', 'high', 'medium', 'low']);
  });
});
