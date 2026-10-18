import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import * as models from '../../models';
import { disableTemplateTags, render } from '../index';

jest.mock('electron');

const failure = (template: string) => render(template).then(() => '', (err: Error) => err.message);

describe('disableTemplateTags()', () => {
  beforeEach(async () => {
    await globalBeforeEach();
    await models.project.all();
  });

  it('leaves a tag out, so templates using it fail instead of running it', async () => {
    expect(await failure("{% file '/nonexistent' %}")).not.toMatch(/unknown block tag/);
    disableTemplateTags(['file']);
    expect(await failure("{% file '/nonexistent' %}")).toMatch(/unknown block tag: file/);
    expect(await render("{% base64 'encode', 'normal', 'hi' %}")).toBe('aGk=');
  });
});
