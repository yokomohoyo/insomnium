import { beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { junitReport, parseDataFile } from '../../network/run-files';
import type { RunResult, RunSummary } from '../../network/runner';
import { formatResult, formatSummary } from '../report';
import { parseRunConfig, selectRequests } from '../run';

describe('parseRunConfig()', () => {
  it('reads the options, and allows any host unless told otherwise', () => {
    expect(parseRunConfig(
      ['--collection', 'a.yaml', '--folder', 'Users/Admin', '--env', 'ci', '--iterations', '3', '--data', 'rows.csv', '--delay', '50', '--bail', '--junit', 'report.xml', '--json', 'report.json', '--html', 'report.html', '--csv', 'report.csv'],
      { INSOMNIUM_VAR_token: 't', INSOMNIUM_VALIDATE_SSL: 'false', INSOMNIUM_ALLOWED_ENV: 'CI_*' },
    )).toEqual({
      collections: ['a.yaml'],
      repos: [],
      folder: 'Users/Admin',
      environment: 'ci',
      iterations: 3,
      data: 'rows.csv',
      delay: 50,
      bail: true,
      junit: 'report.xml',
      json: 'report.json',
      html: 'report.html',
      csv: 'report.csv',
      allowedHosts: ['*'],
      variables: { token: 't' },
      validateSSL: false,
      allowedEnvironmentVariables: 'CI_*',
      allowedSecrets: '',
    });
    expect(parseRunConfig(['--collection', 'a.yaml'], { INSOMNIUM_ALLOWED_HOSTS: 'api.example.com' }).allowedHosts).toEqual(['api.example.com']);
  });

  it.each([
    [[], /at least one --collection/],
    [['--collection'], /--collection needs a value/],
    [['--collection', 'a', '--iterations', '0'], /--iterations must be a whole number of at least 1/],
    [['--collection', 'a', '--delay', '-5'], /--delay must be a whole number of at least 0/],
    [['--collection', 'a', '--nope'], /Unknown option --nope/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseRunConfig(argv as string[], {})).toThrow(message);
  });
});

describe('parseDataFile()', () => {
  it('reads CSV with a header row, and JSON objects', () => {
    // with the byte order mark Excel writes
    expect(parseDataFile('rows.csv', String.fromCharCode(0xfeff) + 'id,name\n1,Tom\n\n2,"Jones, Tim"\n')).toEqual([{ id: '1', name: 'Tom' }, { id: '2', name: 'Jones, Tim' }]);
    // one column, so no delimiter to find
    expect(parseDataFile('rows.csv', 'row\none\ntwo\n')).toEqual([{ row: 'one' }, { row: 'two' }]);
    expect(parseDataFile('rows.json', '[{"id": 1}, {"id": 2}]')).toEqual([{ id: 1 }, { id: 2 }]);
    expect(parseDataFile('row.json', '{"id": 1}')).toEqual([{ id: 1 }]);
  });

  it('refuses rows it cannot use', () => {
    expect(() => parseDataFile('rows.json', '[1, 2]')).toThrow(/must hold an object, or an array of objects/);
    expect(() => parseDataFile('rows.csv', 'a,b\n1,2,3\n')).toThrow(/rows.csv: Too many fields/);
  });
});

describe('selectRequests()', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
  });

  it('runs everything, or one folder found by its path or a name only it has', async () => {
    const workspace = await models.workspace.create({ name: 'API' });
    const users = await models.requestGroup.create({ parentId: workspace._id, name: 'Users', metaSortKey: 1 });
    const admin = await models.requestGroup.create({ parentId: users._id, name: 'Admin' });
    const pets = await models.requestGroup.create({ parentId: workspace._id, name: 'Pets', metaSortKey: 2 });
    await models.requestGroup.create({ parentId: pets._id, name: 'Admin' });
    await models.request.create({ parentId: users._id, name: 'list users' });
    await models.request.create({ parentId: admin._id, name: 'promote' });
    await models.request.create({ parentId: pets._id, name: 'list pets' });

    const names = async (folder?: string) => (await selectRequests([workspace], folder)).map(({ request, folders }) => [...folders, request.name].join('/'));
    expect(await names()).toEqual(['Users/list users', 'Users/Admin/promote', 'Pets/list pets']);
    expect(await names('Pets')).toEqual(['Pets/list pets']);
    expect(await names(' Users / Admin ')).toEqual(['Users/Admin/promote']);
    await expect(names('Admin')).rejects.toThrow("'Admin' names 2 folders: Users/Admin, Pets/Admin. Give its path.");
    await expect(names('Nope')).rejects.toThrow("No folder 'Nope'. The collections have: Users, Users/Admin, Pets, Pets/Admin");
  });
});

describe('reports', () => {
  const passed: RunResult = {
    iteration: 1,
    requestId: 'req_1',
    name: 'get <user>',
    folders: ['Users'],
    method: 'GET',
    url: 'http://localhost/users/1',
    statusCode: 200,
    statusMessage: 'OK',
    elapsedTime: 12.4,
    assertions: [
      { id: 'a1', passed: true, message: 'Status code equals 200' },
      { id: 'a2', passed: false, message: 'JSON path $.name equals "Tom" & co: got "Tim"' },
    ],
    passed: false,
  };
  const failed: RunResult = { iteration: 1, requestId: 'req_2', name: 'down', folders: [], method: 'POST', error: 'Could not resolve host', assertions: [], passed: false };
  const summary: RunSummary = {
    iterations: 1,
    results: [passed, failed],
    requests: { total: 2, failed: 2 },
    assertions: { total: 2, failed: 1 },
    elapsedTime: 1500,
    bailed: false,
    stopped: false,
  };

  it('prints a line per request, its assertions, and a summary', () => {
    expect(formatResult(passed)).toBe([
      '  ✗ Users / get <user>  GET 200 OK  12 ms',
      '      ✓ Status code equals 200',
      '      ✗ JSON path $.name equals "Tom" & co: got "Tim"',
    ].join('\n'));
    expect(formatResult(failed)).toBe('  ✗ down  POST Error: Could not resolve host');
    expect(formatSummary(summary)).toBe('2 requests, 2 failed · 2 assertions, 1 failed · 1.5 s');
  });

  it('writes JUnit XML, a suite per request and a case per assertion', () => {
    expect(junitReport(summary, 'API & co')).toBe([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuites name="API &amp; co" tests="3" failures="2" time="1.500">',
      '  <testsuite name="Users / get &lt;user&gt;" tests="2" failures="1" time="0.012">',
      '    <testcase classname="Users / get &lt;user&gt;" name="Status code equals 200" time="0.012"/>',
      '    <testcase classname="Users / get &lt;user&gt;" name="JSON path $.name equals &quot;Tom&quot; &amp; co: got &quot;Tim&quot;" time="0.012">',
      '      <failure message="JSON path $.name equals &quot;Tom&quot; &amp; co: got &quot;Tim&quot;"/>',
      '    </testcase>',
      '  </testsuite>',
      '  <testsuite name="down" tests="1" failures="1" time="0.000">',
      '    <testcase classname="down" name="POST" time="0.000">',
      '      <failure message="Could not resolve host"/>',
      '    </testcase>',
      '  </testsuite>',
      '</testsuites>',
      '',
    ].join('\n'));
  });
});
