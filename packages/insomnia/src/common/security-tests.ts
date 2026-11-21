// What takes trying an API to find (response-audit.ts is what one exchange
// shows): the request is sent again, changed a little each time, and the
// answers compared with its own. Without its credentials, with a token that
// shouldn't be accepted, as another user, as a user with less privilege, from
// another site, over plain http,
// with a quote in a parameter, and several times in a row.
//
// Only a GET or HEAD is sent again, since a request that changes things would
// change them once more for every test. This file decides what to send and
// what the answers mean; how it's sent is the caller's (network/security-tests.ts).
import { type AuditFinding, errorDetailsIn, isLocalHost, JWT, jwtPart, mostSevereFirst, SECRET_PARAM } from './response-audit';

export interface ProbeVariant {
  // the URL to send to, in place of the request's
  url?: string;
  // without the request's credentials: its auth, its cookies, its credential headers
  withoutCredentials?: boolean;
  // with the other environment's credentials in place of the request's
  asOther?: boolean;
  // with the lower-privileged environment's credentials in place of the request's
  asLower?: boolean;
  // headers sent in place of the request's of the same name, or as well
  headers?: Record<string, string>;
}

export interface ProbeExchange {
  // 0 when nothing came back
  statusCode: number;
  headers: { name: string; value: string }[];
  // the body's text, or its start
  body: string;
  // the request's headers as sent, by lower-case name
  sent: Map<string, string>;
  error?: string;
}

export type SendProbe = (variant: ProbeVariant) => Promise<ProbeExchange>;

export type SecurityCheckOutcome = 'found' | 'passed' | 'skipped' | 'unclear';

export interface SecurityCheck {
  id: string;
  title: string;
  outcome: SecurityCheckOutcome;
  // what was sent and what came back, or why it wasn't tried
  note: string;
}

export interface SecurityTestResult {
  checks: SecurityCheck[];
  findings: AuditFinding[];
  // how many requests were sent
  requests: number;
}

export interface SecurityTestInput {
  method: string;
  // the request's URL as sent, without what its auth adds to the query
  url: string;
  // its auth puts a credential in the query (an API key's)
  credentialInQuery?: boolean;
  // another environment was chosen to send it as
  hasOther?: boolean;
  // an environment with less privilege than the request needs was chosen
  hasLower?: boolean;
  send: SendProbe;
  signal?: AbortSignal;
}

const OBJECT_AUTHORIZATION = 'API1:2023 Broken Object Level Authorization';
const AUTHENTICATION = 'API2:2023 Broken Authentication';
const FUNCTION_AUTHORIZATION = 'API5:2023 Broken Function Level Authorization';
const CONSUMPTION = 'API4:2023 Unrestricted Resource Consumption';
const MISCONFIGURATION = 'API8:2023 Security Misconfiguration';

// an origin nobody's API has a reason to trust
export const PROBE_ORIGIN = 'https://insomnium-security-test.example';
// how many times in a row the request is sent, looking for a rate limit
export const RATE_LIMIT_REQUESTS = 15;
// how many parameters get a quote
const QUOTED_PARAMS = 3;
// the most a run sends: the request itself, without credentials, two tokens,
// as another user, with less privilege, from another origin, over http, the
// quotes, the burst
export const SECURITY_TEST_MAX_REQUESTS = 8 + QUOTED_PARAMS + RATE_LIMIT_REQUESTS;

export const isSafeToRepeat = (method: string) => ['GET', 'HEAD'].includes(method.toUpperCase());

// a header that carries a credential (as well as Authorization and Cookie)
export const CREDENTIAL_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token)$/i;

const ok = (status: number) => status >= 200 && status < 300;
const tokens = (text: string) => new Set(text.match(/[A-Za-z0-9_]+/g) || []);

// the same answer, give or take a timestamp or a request id
export const sameAnswer = (a: ProbeExchange, b: ProbeExchange) => {
  if (!ok(a.statusCode) || !ok(b.statusCode)) {
    return false;
  }
  const [first, second] = [a.body, b.body].map(body => body.replace(/\s+/g, ' ').trim());
  if (first === second) {
    // (nothing to tell two empty answers apart by but their status)
    return first !== '' || a.statusCode === b.statusCode;
  }
  const [one, other] = [tokens(first), tokens(second)];
  if (one.size < 8 || other.size < 8) {
    return false;
  }
  const shared = [...one].filter(token => other.has(token)).length;
  return shared / (one.size + other.size - shared) >= 0.9;
};

const credentialsSent = (exchange: ProbeExchange) =>
  [...exchange.sent].filter(([name]) => CREDENTIAL_HEADER.test(name)).map(([name, value]) => `${name}: ${value}`).sort().join('\n');

const parse = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

// the URL without the credentials written into it
const withoutUrlCredentials = (url: URL) => {
  const bare = new URL(url);
  bare.username = '';
  bare.password = '';
  [...bare.searchParams.keys()].filter(name => SECRET_PARAM.test(name)).forEach(name => bare.searchParams.delete(name));
  return bare;
};

const answered = ({ statusCode, error }: ProbeExchange) => statusCode ? `It answered ${statusCode}.` : `Nothing came back${error ? ` (${error})` : ''}.`;

export async function runSecurityTests({ method, url, credentialInQuery, hasOther, hasLower, send, signal }: SecurityTestInput): Promise<SecurityTestResult> {
  const checks: SecurityCheck[] = [];
  const findings: AuditFinding[] = [];
  let requests = 0;
  const sendOne: SendProbe = variant => {
    requests++;
    return send(variant);
  };
  const result = () => ({ checks, findings: mostSevereFirst(findings), requests });

  if (!isSafeToRepeat(method)) {
    checks.push({
      id: 'baseline',
      title: 'The request as it is',
      outcome: 'skipped',
      note: `Only a GET or HEAD is sent again: a ${method.toUpperCase()} would change things once more for every test.`,
    });
    return result();
  }
  const parsed = parse(url);
  const baseline = await sendOne({});
  if (!parsed || !ok(baseline.statusCode)) {
    checks.push({
      id: 'baseline',
      title: 'The request as it is',
      outcome: 'unclear',
      note: `${answered(baseline)} The tests compare each answer with a successful one, so there was nothing to compare with.`,
    });
    return result();
  }
  checks.push({ id: 'baseline', title: 'The request as it is', outcome: 'passed', note: answered(baseline) });

  const bare = withoutUrlCredentials(parsed);
  const credentialed = Boolean(credentialsSent(baseline)) || Boolean(credentialInQuery) || bare.toString() !== parsed.toString();
  const authorization = baseline.sent.get('authorization') || '';

  // each test on its own: one that fails to send says so, and the rest go on
  const test = async (id: string, title: string, run: () => Promise<Omit<SecurityCheck, 'id' | 'title'> & { finding?: Omit<AuditFinding, 'id'> }>) => {
    if (signal?.aborted) {
      checks.push({ id, title, outcome: 'skipped', note: 'Stopped before it ran.' });
      return;
    }
    try {
      const { finding, ...check } = await run();
      checks.push({ id, title, ...check });
      if (finding) {
        findings.push({ id, ...finding });
      }
    } catch (err) {
      checks.push({ id, title, outcome: 'unclear', note: `It could not be sent: ${err instanceof Error ? err.message : String(err)}` });
    }
  };
  const skipped = (note: string) => ({ outcome: 'skipped' as const, note });

  await test('no-credentials', 'Without its credentials', async () => {
    if (!credentialed) {
      return skipped('The request sends no credentials.');
    }
    const answer = await sendOne({ url: bare.toString(), withoutCredentials: true });
    if (sameAnswer(answer, baseline)) {
      return {
        outcome: 'found',
        note: `${answered(answer)} The answer was the same as with credentials.`,
        finding: {
          severity: 'high',
          owasp: AUTHENTICATION,
          title: 'It answers the same without credentials',
          detail: "Anyone can read this without signing in. If it's meant to be public the credentials aren't needed; if not, the server isn't checking them.",
        },
      };
    }
    return ok(answer.statusCode)
      ? { outcome: 'unclear', note: `${answered(answer)} The answer was different from the one with credentials: look at what it gives someone who hasn't signed in.` }
      : { outcome: 'passed', note: answered(answer) };
  });

  const jwt = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1].match(JWT)?.[0];
  const [head = '', payload = '', signature = ''] = (jwt || '').split('.');
  const withToken = async (token: string, title: string, detail: string) => {
    const answer = await sendOne({ headers: { Authorization: `Bearer ${token}` } });
    return sameAnswer(answer, baseline)
      ? {
        outcome: 'found' as const,
        note: `${answered(answer)} The answer was the same as with the real token.`,
        finding: { severity: 'high' as const, owasp: AUTHENTICATION, title, detail, evidence: "the request's Authorization header" },
      }
      : { outcome: 'passed' as const, note: answered(answer) };
  };
  await test('token-signature', 'With a token whose signature is wrong', async () => {
    if (!jwt || !signature) {
      return skipped(jwt ? "The request's token has no signature to change." : 'The request sends no JSON Web Token.');
    }
    // (another character in the middle: the last one has bits that don't count)
    const middle = Math.floor(signature.length / 2);
    const changed = signature.slice(0, middle) + (signature[middle] === 'A' ? 'B' : 'A') + signature.slice(middle + 1);
    return withToken(
      `${head}.${payload}.${changed}`,
      'It accepts a token whose signature is wrong',
      "The server reads the token without checking who signed it, so anyone can write their own. Verify the signature before trusting what's in it.",
    );
  });
  await test('token-unsigned', 'With an unsigned token', async () => {
    const header = jwt ? jwtPart(head) : null;
    if (!header) {
      return skipped('The request sends no JSON Web Token.');
    }
    const unsigned = Buffer.from(JSON.stringify({ ...header, alg: 'none' })).toString('base64url');
    return withToken(
      `${unsigned}.${payload}.`,
      'It accepts an unsigned token',
      'A token that says its algorithm is none is accepted, so anyone can write their own. Accept only the algorithms the server signs with.',
    );
  });

  await test('other-user', 'As another user', async () => {
    if (!hasOther) {
      return skipped("No other environment was chosen to send it as. Choose one that holds another user's credentials.");
    }
    const answer = await sendOne({ asOther: true });
    if (credentialsSent(answer) === credentialsSent(baseline)) {
      return skipped('The other environment sends the same credentials as this one.');
    }
    if (sameAnswer(answer, baseline)) {
      return {
        outcome: 'found',
        note: `${answered(answer)} The answer was the same as for the first user.`,
        finding: {
          severity: 'medium',
          owasp: OBJECT_AUTHORIZATION,
          title: 'Another user gets the same answer',
          detail: "If this is one user's own data, the server gives it to whoever asks by its id. Check on the server that what's asked for belongs to the caller. Data that every user shares is meant to answer this way.",
        },
      };
    }
    return ok(answer.statusCode)
      ? { outcome: 'unclear', note: `${answered(answer)} The answer was different from the first user's: look at whether it is the other user's own.` }
      : { outcome: 'passed', note: answered(answer) };
  });

  // Choosing the environment is what says the request needs more privilege
  // than it has: so any answer that isn't a refusal is one too many
  await test('lower-privilege', 'With less privilege', async () => {
    if (!hasLower) {
      return skipped('No environment with less privilege was chosen. Choose one for a request that only some users may make: an admin\'s, say.');
    }
    const answer = await sendOne({ asLower: true });
    if (credentialsSent(answer) === credentialsSent(baseline)) {
      return skipped('The environment with less privilege sends the same credentials as this one.');
    }
    if (!ok(answer.statusCode)) {
      return { outcome: 'passed', note: answered(answer) };
    }
    const same = sameAnswer(answer, baseline);
    return {
      outcome: 'found',
      note: `${answered(answer)} ${same ? 'The answer was the same as with full privilege.' : 'The answer was different from the one with full privilege, but it was not refused.'}`,
      finding: {
        severity: same ? 'high' : 'medium',
        owasp: FUNCTION_AUTHORIZATION,
        title: 'A user with less privilege can make this request',
        detail: same
          ? "The server does what's asked without checking that the caller may ask it. Check the caller's role on the server for every function, not only in what the client shows."
          : "The server answers where it should refuse. Look at what it gave: if this is for some users only, check the caller's role on the server and answer 403.",
      },
    };
  });

  await test('cors-any-origin', 'From another site', async () => {
    const answer = await sendOne({ headers: { Origin: PROBE_ORIGIN } });
    const header = (name: string) => answer.headers.find(h => h.name.toLowerCase() === name)?.value.trim() || '';
    if (header('access-control-allow-origin') !== PROBE_ORIGIN) {
      return { outcome: 'passed', note: `${answered(answer)} It didn't allow the origin ${PROBE_ORIGIN}.` };
    }
    if (!/^true$/i.test(header('access-control-allow-credentials'))) {
      return { outcome: 'passed', note: `${answered(answer)} It allows any origin, without credentials.` };
    }
    return {
      outcome: 'found',
      note: `${answered(answer)} It allowed the origin ${PROBE_ORIGIN}, with credentials.`,
      finding: {
        severity: 'high',
        owasp: MISCONFIGURATION,
        title: 'CORS trusts whichever site asks, with credentials',
        detail: "The server answers with the caller's own Origin and allows credentials, so any site a signed-in user visits can read this as them. Allow only the origins that are yours.",
        evidence: `Access-Control-Allow-Origin: ${PROBE_ORIGIN}, Access-Control-Allow-Credentials: true`,
      },
    };
  });

  await test('answers-plain-http', 'Over plain http', async () => {
    if (bare.protocol !== 'https:') {
      return skipped('The request is not sent over https.');
    }
    if (isLocalHost(bare.hostname)) {
      return skipped('The host is on this computer or a private network.');
    }
    if (bare.port) {
      return skipped("The URL names its port, which plain http wouldn't be on.");
    }
    const plain = new URL(bare);
    plain.protocol = 'http:';
    const answer = await sendOne({ url: plain.toString(), withoutCredentials: true });
    if (!ok(answer.statusCode)) {
      return { outcome: 'passed', note: answer.statusCode >= 300 && answer.statusCode < 400 ? `${answered(answer)} It sends the caller on to somewhere else.` : answered(answer) };
    }
    return {
      outcome: 'found',
      note: `${answered(answer)} It was sent without credentials.`,
      finding: {
        severity: 'medium',
        owasp: MISCONFIGURATION,
        title: 'It also answers over plain http',
        detail: 'A client set up with http by mistake works, and sends its credentials unencrypted every time. Refuse plain http, or redirect it, and send Strict-Transport-Security.',
      },
    };
  });

  await test('quote-in-parameter', 'With a quote in a parameter', async () => {
    const names = [...new Set(bare.searchParams.keys())].slice(0, QUOTED_PARAMS);
    if (!names.length) {
      return skipped('The URL has no query parameters.');
    }
    const before = errorDetailsIn(baseline.body);
    const notes: string[] = [];
    for (const name of names) {
      const quoted = new URL(parsed);
      quoted.searchParams.set(name, `${quoted.searchParams.get(name)}'`);
      const answer = await sendOne({ url: quoted.toString() });
      const said = errorDetailsIn(answer.body);
      if (said && said !== before) {
        const database = said === 'a database error';
        return {
          outcome: 'found',
          note: `${answered(answer)} With a quote added to ${name}, the answer showed ${said}.`,
          finding: {
            severity: database ? 'high' : 'medium',
            owasp: MISCONFIGURATION,
            title: database ? 'A quote in a parameter reaches the database' : `A quote in a parameter makes the server show ${said}`,
            detail: database
              ? "The parameter's value is put into a query as it comes, which is how SQL injection starts. Pass values to the database as parameters, never as part of the query's text."
              : 'The server fails on a value it should have refused, and says how. Check what it accepts, and answer with a plain error.',
            evidence: name,
          },
        };
      }
      if (answer.statusCode >= 500) {
        return {
          outcome: 'found',
          note: `${answered(answer)} That was with a quote added to ${name}.`,
          finding: {
            severity: 'low',
            owasp: MISCONFIGURATION,
            title: 'A quote in a parameter makes the server fail',
            detail: "A value the server didn't expect gets as far as breaking something. Check what it accepts, and refuse the rest with a 400.",
            evidence: name,
          },
        };
      }
      notes.push(`${name}: ${answer.statusCode || 'nothing'}`);
    }
    return { outcome: 'passed', note: `With a quote added, it answered ${notes.join(', ')}.` };
  });

  await test('rate-limit', `${RATE_LIMIT_REQUESTS} times in a row`, async () => {
    const limited = ({ headers }: ProbeExchange) => headers.some(({ name }) => /^(retry-after|(x-)?rate-?limit)/i.test(name));
    if (limited(baseline)) {
      return { outcome: 'passed', note: 'Its answers have rate limit headers.' };
    }
    for (let sent = 1; sent <= RATE_LIMIT_REQUESTS; sent++) {
      if (signal?.aborted) {
        return skipped(`Stopped after ${sent - 1}.`);
      }
      const answer = await sendOne({});
      if (answer.statusCode === 429 || limited(answer)) {
        return { outcome: 'passed', note: answer.statusCode === 429 ? `It answered 429 to request ${sent}.` : 'Its answers have rate limit headers.' };
      }
    }
    return {
      outcome: 'found',
      note: `It answered all ${RATE_LIMIT_REQUESTS}, with no rate limit headers.`,
      finding: {
        severity: 'low',
        owasp: CONSUMPTION,
        title: 'No sign of a rate limit',
        detail: `${RATE_LIMIT_REQUESTS} requests in a row is too few to reach most limits, but nothing in the answers says there is one. Without a limit, one caller can take the API's whole capacity, or guess at credentials for as long as they like.`,
        evidence: `${RATE_LIMIT_REQUESTS} requests in a row`,
      },
    };
  });

  return result();
}
