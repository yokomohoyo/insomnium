/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import type { FuzzAttemptResult, FuzzRunSummary } from '../../network/fuzz-run';
import type { RunnableRequest } from '../../network/runner';
import { assertMayFuzz, CHANGE_FLAG, failsFuzz, findFuzzRequest, formatAttempt, formatFuzzSummary, FUZZ_USAGE, parseFuzzConfig } from '../fuzz';
import { ALLOW_FLAG } from '../security';

const ARGS = ['--collection', 'a.yaml', '--request', 'Orders/List', ALLOW_FLAG, '--lists', 'sql'];

describe('parseFuzzConfig()', () => {
  it('reads the options', () => {
    expect(parseFuzzConfig(
      ['--collection', 'a.yaml', '--request', 'Users/Create user', ALLOW_FLAG, CHANGE_FLAG, '--env', 'ci', '--positions', 'Query: status, Body: name', '--positions', 'all', '--lists', 'sql,types', '--payloads', 'mine.txt', '--delay', '50', '--no-fail', '--csv', 'fuzz.csv', '--json', 'fuzz.json'],
      { INSOMNIUM_ALLOWED_HOSTS: 'staging.example.com', INSOMNIUM_VAR_token: 't' },
    )).toEqual({
      collections: ['a.yaml'],
      repos: [],
      allowed: true,
      mayChangeData: true,
      request: 'Users/Create user',
      environment: 'ci',
      positions: ['Query: status', 'Body: name', 'all'],
      lists: ['sql', 'types'],
      payloadFile: 'mine.txt',
      delay: 50,
      noFail: true,
      csv: 'fuzz.csv',
      json: 'fuzz.json',
      allowedHosts: ['staging.example.com'],
      variables: { token: 't' },
      validateSSL: true,
      allowedEnvironmentVariables: '',
      allowedSecrets: '',
    });
  });

  it("doesn't start without the go-ahead on the command line", () => {
    const without = ARGS.filter(arg => arg !== ALLOW_FLAG);

    expect(() => parseFuzzConfig(without, {})).toThrow(`Pass ${ALLOW_FLAG} to say you're allowed to test this API.`);
    expect(() => parseFuzzConfig(without, { INSOMNIUM_I_MAY_TEST_THIS_API: 'true' })).toThrow(ALLOW_FLAG);
    expect(parseFuzzConfig(ARGS, {})).toMatchObject({ allowed: true, mayChangeData: false, noFail: false, delay: 0, positions: [] });
  });

  it('needs a request and something to try', () => {
    expect(() => parseFuzzConfig(['--collection', 'a.yaml', ALLOW_FLAG, '--lists', 'sql'], {})).toThrow('Name the request to fuzz with --request');
    expect(() => parseFuzzConfig(['--collection', 'a.yaml', '--request', 'List', ALLOW_FLAG], {})).toThrow('Say what to try: --lists (sql, nosql, traversal, script, commands, ids, types, fields) or --payloads <file>');
    expect(parseFuzzConfig(['--collection', 'a.yaml', '--request', 'List', ALLOW_FLAG, '--payloads', 'mine.txt'], {}).lists).toEqual([]);
  });

  it('refuses a list it has no name for, a delay that is no number, and an unknown option', () => {
    expect(() => parseFuzzConfig([...ARGS, '--lists', 'sql,made-up'], {})).toThrow('--lists: no list named made-up. The lists are: sql, nosql,');
    expect(() => parseFuzzConfig([...ARGS, '--delay', 'soon'], {})).toThrow('--delay must be a whole number of milliseconds');
    expect(() => parseFuzzConfig([...ARGS, '--bail'], {})).toThrow('Unknown option --bail');
    expect(() => parseFuzzConfig([...ARGS, '--request'], {})).toThrow('--request needs a value');
  });

  it('says in its usage what the go-aheads are', () => {
    expect(FUZZ_USAGE).toContain(ALLOW_FLAG);
    expect(FUZZ_USAGE).toContain(CHANGE_FLAG);
  });
});

const runnable = (name: string, folders: string[] = [], method = 'GET') => ({ request: { _id: `req_${name}`, name, method }, folders }) as unknown as RunnableRequest;

describe('findFuzzRequest()', () => {
  const requests = [runnable('List', ['Orders']), runnable('Create', ['Orders'], 'POST'), runnable('List', ['Users']), runnable('Health')];

  it('finds a request by its path, or by its name when only one has it', () => {
    expect(findFuzzRequest(requests, 'Orders/List').request._id).toBe('req_List');
    expect(findFuzzRequest(requests, ' Orders / Create ').request.method).toBe('POST');
    expect(findFuzzRequest(requests, 'Health').folders).toEqual([]);
    expect(findFuzzRequest(requests, 'Create').request.method).toBe('POST');
  });

  it("names what there is when it can't tell which", () => {
    expect(() => findFuzzRequest(requests, 'List')).toThrow("'List' names 2 requests: Orders/List, Users/List. Give its path.");
    expect(() => findFuzzRequest(requests, 'Orders/Delete')).toThrow("No request 'Orders/Delete'. The collections have: Orders/List, Orders/Create, Users/List, Health");
    expect(() => findFuzzRequest([], 'List')).toThrow('The collections have: no HTTP requests');
  });
});

describe('assertMayFuzz()', () => {
  it('asks for a second go-ahead for a request that changes data', () => {
    expect(() => assertMayFuzz('GET', false)).not.toThrow();
    expect(() => assertMayFuzz('HEAD', false)).not.toThrow();
    expect(() => assertMayFuzz('POST', false)).toThrow(`A POST changes data once for every attempt the server accepts. Pass ${CHANGE_FLAG}`);
    expect(() => assertMayFuzz('DELETE', true)).not.toThrow();
  });
});

const attempt = (index: number, patch: Partial<FuzzAttemptResult> = {}): FuzzAttemptResult =>
  ({ index, pointId: 'query:u0', position: 'Query: status', payload: "'", statusCode: 200, bytes: 105, elapsed: 3.4, flags: [], notable: false, snippet: '', ...patch });
const summary = (attempts: FuzzAttemptResult[]): FuzzRunSummary =>
  ({ baseline: { statusCode: 200, bytes: 105, elapsed: 3 }, attempts, notable: attempts.filter(({ notable }) => notable).length, requests: attempts.length + 1, stopped: false });
const NOTABLE = attempt(2, { statusCode: 500, bytes: 71, notable: true, flags: [{ id: 'server-error', label: 'The server failed', notable: true }, { id: 'error-details', label: 'A database error', notable: true }] });
const UNSENT = attempt(3, { statusCode: 0, error: 'Refusing to send to 10.0.0.1' });

describe('the console output', () => {
  it('has two lines for an attempt: where and what, then what came back', () => {
    expect(formatAttempt(NOTABLE)).toBe("  ✗    2  Query: status  ←  '\n        500, 71 B, 3 ms: The server failed; A database error");
    expect(formatAttempt(UNSENT)).toBe("  !    3  Query: status  ←  '\n        Refusing to send to 10.0.0.1");
    expect(formatAttempt(attempt(4, { payload: 'A'.repeat(5000) }))).toContain(`${'A'.repeat(57)}… (5000 characters)`);
  });

  it('sums up, and says whether the run failed', () => {
    expect(formatFuzzSummary(summary([attempt(1), NOTABLE]), false).split('\n').slice(0, 2)).toEqual(['2 attempts · 1 worth a look · 3 sent', 'Failed: 1 attempt stood out']);
    expect(formatFuzzSummary(summary([attempt(1)]), false)).toContain('Nothing stood out');
    expect(formatFuzzSummary(summary([NOTABLE]), true)).toContain('Not failing on attempts that stood out (--no-fail)');
    expect(formatFuzzSummary(summary([attempt(1), UNSENT]), true).split('\n').slice(0, 2)).toEqual(['2 attempts · 0 worth a look · 1 could not be sent · 3 sent', 'Failed: 1 attempt could not be sent']);
  });
});

describe('failsFuzz()', () => {
  it('fails when an attempt stood out, unless told not to, and always when one could not be sent', () => {
    expect(failsFuzz(summary([attempt(1)]), false)).toBe(false);
    expect(failsFuzz(summary([NOTABLE]), false)).toBe(true);
    expect(failsFuzz(summary([NOTABLE]), true)).toBe(false);
    expect(failsFuzz(summary([UNSENT]), true)).toBe(true);
  });
});
