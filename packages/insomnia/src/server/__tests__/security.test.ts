import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import type { SecurityRunItem, SecurityRunSummary } from '../../network/security-run';
import { ALLOW_FLAG, failsRun, findOtherEnvironment, formatBaseline, formatInventory, formatItem, formatSecuritySummary, parseSecurityConfig, SECURITY_USAGE, untested } from '../security';

const HOSTS = { INSOMNIUM_ALLOWED_HOSTS: 'api.example.com, staging.example.com' };
const ARGS = ['--collection', 'a.yaml', ALLOW_FLAG];

describe('parseSecurityConfig()', () => {
  it('reads the options', () => {
    expect(parseSecurityConfig(
      [...ARGS, '--folder', 'Users/Admin', '--env', 'ci', '--as', 'other user', '--as-lower', 'viewer', '--rate-limit-requests', '300', '--fail-on', 'Medium', '--ignore', 'nosniff-missing, rate-limit', '--ignore', 'hsts-missing', '--baseline', 'known.json', '--markdown', 'report.md', '--json', 'report.json', '--sarif', 'report.sarif'],
      { ...HOSTS, INSOMNIUM_VAR_token: 't', INSOMNIUM_VALIDATE_SSL: 'false' },
    )).toEqual({
      collections: ['a.yaml'],
      repos: [],
      allowed: true,
      folder: 'Users/Admin',
      environment: 'ci',
      otherEnvironment: 'other user',
      lowerEnvironment: 'viewer',
      rateLimitRequests: 300,
      failOn: 'medium',
      ignore: ['nosniff-missing', 'rate-limit', 'hsts-missing'],
      baseline: 'known.json',
      markdown: 'report.md',
      json: 'report.json',
      sarif: 'report.sarif',
      allowedHosts: ['api.example.com', 'staging.example.com'],
      variables: { token: 't' },
      validateSSL: false,
      allowedEnvironmentVariables: '',
      allowedSecrets: '',
    });
  });

  it('fails on a high finding unless told otherwise', () => {
    expect(parseSecurityConfig(ARGS, HOSTS)).toMatchObject({ failOn: 'high', ignore: [] });
    expect(parseSecurityConfig([...ARGS, '--fail-on', 'none'], HOSTS).failOn).toBe('none');
    expect(() => parseSecurityConfig([...ARGS, '--fail-on', 'critical'], HOSTS)).toThrow('--fail-on must be one of high, medium, low, info or none');
  });

  it("doesn't start without the go-ahead on the command line", () => {
    expect(() => parseSecurityConfig(['--collection', 'a.yaml'], HOSTS)).toThrow(`Pass ${ALLOW_FLAG} to say you're allowed to test it.`);
    // (it has no other spelling, and isn't read from the environment)
    expect(() => parseSecurityConfig(['--collection', 'a.yaml'], { ...HOSTS, INSOMNIUM_I_MAY_TEST_THIS_API: 'true', I_MAY_TEST_THIS_API: '1' })).toThrow(ALLOW_FLAG);
    expect(() => parseSecurityConfig(['--collection', 'a.yaml', '--allow'], HOSTS)).toThrow('Unknown option --allow');
  });

  it('sends to any host unless the pipeline narrows it, as run does', () => {
    expect(parseSecurityConfig(ARGS, {}).allowedHosts).toEqual(['*']);
    expect(parseSecurityConfig(ARGS, { INSOMNIUM_ALLOWED_HOSTS: ' ' }).allowedHosts).toEqual(['*']);
    expect(parseSecurityConfig(ARGS, { INSOMNIUM_ALLOWED_HOSTS: 'api.example.com,*.example.com' }).allowedHosts).toEqual(['api.example.com', '*.example.com']);
    // (the flag is still asked for, hosts or no hosts)
    expect(() => parseSecurityConfig(['--collection', 'a.yaml'], {})).toThrow(ALLOW_FLAG);
  });

  it('refuses a rule it has no name for, an unknown option, and no collection', () => {
    expect(() => parseSecurityConfig([...ARGS, '--ignore', 'nosniff-missing,made-up'], HOSTS)).toThrow('--ignore: no rule named made-up.');
    expect(() => parseSecurityConfig([...ARGS, '--bail'], HOSTS)).toThrow('Unknown option --bail');
    expect(() => parseSecurityConfig([...ARGS, '--as'], HOSTS)).toThrow('--as needs a value');
    expect(() => parseSecurityConfig([...ARGS, '--rate-limit-requests', '5000'], HOSTS)).toThrow('--rate-limit-requests must be a whole number from 0 to 1000');
    expect(() => parseSecurityConfig([...ARGS, '--rate-limit-requests', 'lots'], HOSTS)).toThrow('--rate-limit-requests must be a whole number');
    expect(parseSecurityConfig([...ARGS, '--rate-limit-requests', '0'], HOSTS).rateLimitRequests).toBe(0);
    expect(parseSecurityConfig(ARGS, HOSTS).rateLimitRequests).toBeUndefined();
    expect(() => parseSecurityConfig([ALLOW_FLAG], HOSTS)).toThrow();
  });

  it('says in its usage what the go-ahead is', () => {
    expect(SECURITY_USAGE).toContain(ALLOW_FLAG);
    expect(SECURITY_USAGE).toContain('it is required on the command line, every time');
  });
});

const item = (patch: Partial<SecurityRunItem> = {}): SecurityRunItem =>
  ({ requestId: 'req_1', name: 'List', folders: ['Orders'], method: 'GET', url: 'https://api.example.com/orders', outcome: 'tested', findings: [], checks: [], requests: 9, ...patch });
const summary = (findings: Partial<SecurityRunSummary['findings']>, items = [item()]): SecurityRunSummary =>
  ({ items, requests: 9, stopped: false, restrictedUntried: 0, findings: { high: 0, medium: 0, low: 0, info: 0, ...findings } });

describe('failsRun()', () => {
  it('fails on a finding as severe as asked, or worse', () => {
    expect(failsRun(summary({ high: 1 }), 'high')).toBe(true);
    expect(failsRun(summary({ medium: 3, low: 2 }), 'high')).toBe(false);
    expect(failsRun(summary({ medium: 1 }), 'medium')).toBe(true);
    expect(failsRun(summary({ high: 1 }), 'low')).toBe(true);
    expect(failsRun(summary({ info: 1 }), 'low')).toBe(false);
    expect(failsRun(summary({ info: 1 }), 'info')).toBe(true);
  });

  it('never fails on findings when told not to', () => {
    expect(failsRun(summary({ high: 4 }), 'none')).toBe(false);
  });

  it("fails when a request that should have been tested couldn't be, whatever was asked", () => {
    const missed = summary({}, [item(), item({ requestId: 'req_2', outcome: 'skipped', failed: true, note: 'It could not be tested: Refusing to send to localhost' })]);

    expect(untested(missed)).toBe(1);
    expect(failsRun(missed, 'high')).toBe(true);
    expect(failsRun(missed, 'none')).toBe(true);
    // (a request that is never sent isn't one of those)
    expect(failsRun(summary({}, [item({ outcome: 'skipped', method: 'POST' })]), 'high')).toBe(false);
    expect(formatSecuritySummary(missed, 'none')).toContain('2 requests, 1 tested, 1 could not be tested');
    expect(formatSecuritySummary(missed, 'none')).toContain('Failed: 1 request could not be tested');
    expect(formatItem(missed.items[1])).toContain('  ! Orders / List');
  });
});

describe('against a baseline', () => {
  const none = { high: 0, medium: 0, low: 0, info: 0 };

  it('fails on a new finding alone', () => {
    const known = { known: 3, fresh: none, fixed: [] };

    expect(failsRun(summary({ high: 3 }), 'high', known)).toBe(false);
    expect(failsRun(summary({ high: 3 }), 'high', { ...known, fresh: { ...none, high: 1 } })).toBe(true);
    expect(failsRun(summary({ high: 3 }), 'high', { ...known, fresh: { ...none, medium: 1 } })).toBe(false);
    expect(failsRun(summary({ high: 3 }), 'medium', { ...known, fresh: { ...none, medium: 1 } })).toBe(true);
    // a request that couldn't be tested still fails it
    expect(failsRun(summary({}, [item({ outcome: 'skipped', failed: true })]), 'high', known)).toBe(true);
  });

  it('marks the known findings, and says how the run compares', () => {
    expect(formatItem(item({
      findings: [
        { id: 'no-credentials', severity: 'high', owasp: '', title: 'It answers the same without credentials', detail: '', known: true },
        { id: 'token-unsigned', severity: 'high', owasp: '', title: 'It accepts an unsigned token', detail: '' },
      ],
    })).split('\n').slice(1)).toEqual([
      '      HIGH   It answers the same without credentials  [no-credentials]  known',
      '      HIGH   It accepts an unsigned token  [token-unsigned]',
    ]);

    const fixed = [{ key: 'GET Orders / List', id: 'hsts-missing', title: 'No HSTS', evidence: 'Strict-Transport-Security', request: 'Orders / List' }];
    expect(formatBaseline({ known: 2, fresh: { ...none, high: 1, low: 2 }, fixed })).toBe('Against the baseline: 3 new, 2 known, 1 no longer found\n  - Orders / List: No HSTS (Strict-Transport-Security)  [hsts-missing]');
    expect(formatBaseline({ known: 2, fresh: none, fixed: [] })).toBe('Against the baseline: 0 new, 2 known');

    const lines = formatSecuritySummary(summary({ high: 2 }), 'high', { known: 2, fresh: none, fixed: [] }).split('\n');
    expect(lines).toContain('Against the baseline: 0 new, 2 known');
    expect(lines).toContain('Nothing new is high or worse');
    expect(formatSecuritySummary(summary({ high: 2 }), 'high', { known: 1, fresh: { ...none, high: 1 }, fixed: [] })).toContain('Failed: a new finding is high or worse (--fail-on high)');
  });
});

describe('the console output', () => {
  it('has a line for each request, with what was found and each rule\'s id', () => {
    expect(formatItem(item({
      findings: [
        { id: 'no-credentials', severity: 'high', owasp: 'API2:2023 Broken Authentication', title: 'It answers the same without credentials', detail: '' },
        { id: 'secret-in-url', severity: 'medium', owasp: 'API2:2023 Broken Authentication', title: 'A credential in the URL', detail: '', evidence: 'token' },
      ],
    }))).toBe([
      '  ✗ Orders / List  GET https://api.example.com/orders',
      '      HIGH   It answers the same without credentials  [no-credentials]',
      '      MEDIUM A credential in the URL (token)  [secret-in-url]',
    ].join('\n'));
    expect(formatItem(item())).toBe('  ✓ Orders / List  GET https://api.example.com/orders');
    expect(formatItem(item({ outcome: 'skipped', method: 'POST', note: "A POST isn't sent again, and it has no response to look at: send it first." })))
      .toBe("  - Orders / List  POST https://api.example.com/orders\n      A POST isn't sent again, and it has no response to look at: send it first.");
  });

  it("says which of the spec's operations the run didn't reach", () => {
    expect(formatInventory({ operations: 5, uncovered: ['GET /orders/{id}', 'DELETE /orders/{id}'] })).toBe([
      "Against the spec: 2 of 5 operations have no request, so they weren't checked",
      '  - GET /orders/{id}',
      '  - DELETE /orders/{id}',
    ].join('\n'));
    expect(formatInventory({ operations: 5, uncovered: ['GET /health'] }).split('\n')[0]).toBe("Against the spec: 1 of 5 operations has no request, so it wasn't checked");
    expect(formatInventory({ operations: 3, uncovered: [] })).toBe('Against the spec: each of its 3 operations has a request');
  });

  it('marks a restricted request, and says when they went untried with less privilege', () => {
    expect(formatItem(item({ restricted: true }))).toBe('  ✓ Orders / List (restricted)  GET https://api.example.com/orders');
    expect(formatSecuritySummary({ ...summary({}), restrictedUntried: 2 }, 'high')).toContain('2 requests marked as restricted were not tried with less privilege: pass --as-lower');
    expect(formatSecuritySummary({ ...summary({}), restrictedUntried: 1 }, 'high')).toContain('1 request marked as restricted was not tried');
    expect(formatSecuritySummary(summary({}), 'high')).not.toContain('restricted');
  });

  it('sums up, and says whether the run failed', () => {
    expect(formatSecuritySummary(summary({ high: 1, low: 2 }), 'high').split('\n').slice(0, 2)).toEqual([
      '1 request, 1 tested · 1 high, 2 low · 9 sent',
      'Failed: a finding is high or worse (--fail-on high)',
    ]);
    expect(formatSecuritySummary(summary({ low: 2 }), 'high')).toContain('Nothing high or worse');
    expect(formatSecuritySummary(summary({}), 'none')).toContain('nothing found');
    expect(formatSecuritySummary(summary({ high: 1 }), 'none')).toContain('Not failing on findings (--fail-on none)');
  });
});

describe('findOtherEnvironment()', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
  });

  it("finds the other user's environment by name, and names the ones there are when it can't", async () => {
    const workspace = await models.workspace.create({ name: 'Shop' });
    const base = await models.environment.getOrCreateForParentId(workspace._id);
    const ben = await models.environment.create({ parentId: base._id, name: 'Ben' });
    await models.environment.create({ parentId: base._id, name: 'staging' });

    expect(await findOtherEnvironment([workspace], 'Ben')).toBe(ben._id);
    await expect(findOtherEnvironment([workspace], 'Carl')).rejects.toThrow("No environment named 'Carl' for --as. The collections have: Ben, staging");
    await expect(findOtherEnvironment([workspace], 'Carl', '--as-lower')).rejects.toThrow("No environment named 'Carl' for --as-lower.");
  });
});
