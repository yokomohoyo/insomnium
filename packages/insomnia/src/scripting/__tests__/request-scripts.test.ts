import { beforeEach, describe, expect, it } from '@jest/globals';
import electron from 'electron';

import { globalBeforeEach } from '../../__jest__/before-each';
import { getRenderedRequestAndContext } from '../../common/render';
import * as models from '../../models';
import * as networkUtils from '../../network/network';
import { listRunnableRequests, runRequests } from '../../network/runner';
import { runAfterResponseScript, runPreRequestScript } from '../request-scripts';

window.app = electron.app;

describe('request scripts', () => {
  let workspaceId: string;
  let subEnvironmentId: string;

  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
    workspaceId = (await models.workspace.create({ name: 'Scripts' }))._id;
    const base = await models.environment.getOrCreateForParentId(workspaceId);
    await models.environment.update(base, { data: { host: 'http://localhost' } });
    subEnvironmentId = (await models.environment.create({ parentId: base._id, name: 'staging', data: { stage: 'staging' } }))._id;
  });

  it('runs the pre-request script: its request changes and variables go into the send, its environment changes are kept', async () => {
    const request = await models.request.create({
      parentId: workspaceId,
      url: '{{ host }}/{{ path }}',
      headers: [{ name: 'X-Stage', value: '{{ stage }}' }],
      preRequestScript: "insomnia.variables.set('path', 'users'); insomnia.request.headers.add({ key: 'X-Added', value: 'yes' }); insomnia.environment.set('seen', true); console.log('pre');",
    });
    const scripted = await runPreRequestScript(request, { environmentId: subEnvironmentId });
    expect(scripted.logs).toEqual([{ level: 'log', message: 'pre' }]);

    const { request: rendered } = await getRenderedRequestAndContext({ request: scripted.request, environmentId: subEnvironmentId, iterationData: scripted.variables });
    expect(rendered.url).toBe('http://localhost/users');
    expect(rendered.headers).toEqual([{ name: 'X-Stage', value: 'staging' }, { name: 'X-Added', value: 'yes' }]);
    // the environment in use keeps what the script set; the request itself is unchanged
    expect((await models.environment.getById(subEnvironmentId))?.data).toEqual({ stage: 'staging', seen: true });
    expect((await models.request.getById(request._id))?.headers).toHaveLength(1);
  });

  it('stops the send when the pre-request script fails', async () => {
    const request = await models.request.create({ parentId: workspaceId, preRequestScript: "throw new Error('nope');" });
    await expect(runPreRequestScript(request)).rejects.toThrow('The pre-request script failed: Error: nope (line 1)');
  });

  it("adds the after-response script's tests to the response's results", async () => {
    const request = await models.request.create({
      parentId: workspaceId,
      url: 'http://localhost/',
      assertions: [{ id: 'a1', source: 'status', operator: 'equals', value: '200' }],
      afterResponseScript: "insomnia.test('echoes the url', () => insomnia.expect(insomnia.response.json().options.URL).to.equal('http://localhost/')); insomnia.test('is 404', () => insomnia.response.to.have.status(404)); insomnia.baseEnvironment.set('code', insomnia.response.code);",
    });
    const settings = await models.settings.getOrCreate();
    const { request: rendered, context } = await getRenderedRequestAndContext({ request });
    const response = await networkUtils.sendCurlAndWriteTimeline(rendered, [], null, settings);
    const patch = await networkUtils.responseTransform(response, null, rendered, context, { preRequestLogs: [{ level: 'log', message: 'from before' }] });

    expect(patch.assertionResults?.map(({ passed, message }) => ({ passed, message }))).toEqual([
      { passed: true, message: 'Status code equals 200' },
      { passed: true, message: 'echoes the url' },
      { passed: false, message: 'is 404: expected response to have status code 404 but got 200' },
    ]);
    expect(patch.scriptLogs).toEqual([{ level: 'log', message: 'from before' }]);
    expect((await models.environment.getOrCreateForParentId(workspaceId)).data).toEqual({ host: 'http://localhost', code: 200 });
  });

  it('reports a failed after-response script as a failed result, and skips failed sends', async () => {
    const request = await models.request.create({ parentId: workspaceId, afterResponseScript: 'insomnia.response.json();' });
    const notJson = { elapsedTime: 1, statusCode: 200, bodyPath: '', bytesContent: 0 } as any;
    const { results } = await runAfterResponseScript(request, notJson);
    expect(results).toEqual([{ id: 'script_error', passed: false, message: expect.stringMatching(/^The after-response script failed: SyntaxError: The response body is not JSON/) }]);
    expect(await runAfterResponseScript(request, { elapsedTime: 0, error: 'Could not resolve host' })).toEqual({ results: [], logs: [] });
  });

  it('keeps what the after-response script set to visualize, within limits', async () => {
    const response = { elapsedTime: 1, statusCode: 201, bodyPath: '', bytesContent: 0 } as any;
    const visualized = await models.request.create({ parentId: workspaceId, afterResponseScript: "pm.visualizer.set('<b>{{code}}</b>', { code: pm.response.code });" });
    expect(await runAfterResponseScript(visualized, response)).toEqual({ results: [], logs: [], visualization: { template: '<b>{{code}}</b>', data: { code: 201 } } });

    const cleared = await models.request.create({ parentId: workspaceId, afterResponseScript: "insomnia.visualizer.set('<b>{{code}}</b>'); insomnia.visualizer.clear();" });
    expect((await runAfterResponseScript(cleared, response)).visualization).toBeUndefined();

    const tooLarge = await models.request.create({ parentId: workspaceId, afterResponseScript: "pm.visualizer.set('{{x}}', { x: 'x'.repeat(1100000) });" });
    const { results, visualization } = await runAfterResponseScript(tooLarge, response);
    expect(visualization).toBeUndefined();
    expect(results).toEqual([{ id: 'script_visualization', passed: false, message: 'The visualization is larger than 1 MB: visualize less of the response' }]);
  });

  it("doesn't render a script's {{ }}, which is code", async () => {
    const request = await models.request.create({ parentId: workspaceId, preRequestScript: "const t = '{{ host }}';", afterResponseScript: '// {{ nope }}' });
    const { request: rendered } = await getRenderedRequestAndContext({ request });
    expect(rendered.preRequestScript).toBe("const t = '{{ host }}';");
    expect(rendered.afterResponseScript).toBe('// {{ nope }}');
  });

  it('chains through the environment in a run: one request saves what the next sends', async () => {
    await models.request.create({ parentId: workspaceId, name: 'login', metaSortKey: 1, url: 'http://localhost/login', afterResponseScript: "insomnia.environment.set('token', 'from-login');" });
    await models.request.create({ parentId: workspaceId, name: 'me', metaSortKey: 2, url: 'http://localhost/{{ token }}' });
    const summary = await runRequests(await listRunnableRequests(workspaceId));
    expect(summary.results.map(({ name, url }) => [name, url])).toEqual([['login', 'http://localhost/login'], ['me', 'http://localhost/from-login']]);
  });
});
