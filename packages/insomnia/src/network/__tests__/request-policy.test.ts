import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import { getRenderedRequestAndContext } from '../../common/render';
import * as models from '../../models';
import * as networkUtils from '../network';
import { setRequestPolicy } from '../request-policy';

jest.mock('electron');

describe('the request policy', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
  });

  afterEach(() => setRequestPolicy(null));

  const send = async (url: string) => {
    const workspace = await models.workspace.create();
    const request = Object.assign(models.request.init(), { _id: 'req_1', parentId: workspace._id, url });
    const { request: rendered } = await getRenderedRequestAndContext({ request });
    return networkUtils.sendCurlAndWriteTimeline(rendered, [], null, await models.settings.getOrCreate());
  };

  it('is checked with the final url before anything is sent, so every way of sending is covered', async () => {
    const checked: string[] = [];
    setRequestPolicy(url => {
      checked.push(url);
      throw new Error('Refusing to send');
    });

    await expect(send('http://blocked.example.com/path')).rejects.toThrow('Refusing to send');
    expect(checked).toEqual(['http://blocked.example.com/path']);
  });

  it('passes a unix socket as unix:<path>', async () => {
    const checked: string[] = [];
    setRequestPolicy(url => {
      checked.push(url);
      throw new Error('Refusing to send');
    });

    await expect(send('http://unix:/var/run/docker.sock:/containers/json')).rejects.toThrow();
    expect(checked).toEqual(['unix:/var/run/docker.sock']);
  });

  it('turns redirects off while one is set, since a redirect could go anywhere', async () => {
    const options = async () => JSON.parse(String(models.response.getBodyBuffer(await send('http://allowed.example.com/')))).options;
    expect((await options()).FOLLOWLOCATION).toBe(true);
    setRequestPolicy(() => {});
    expect((await options()).FOLLOWLOCATION).toBe(false);
  });

  it('lets everything through when the app sets none', async () => {
    await expect(send('http://localhost/')).resolves.toMatchObject({ statusCode: 200 });
  });
});
