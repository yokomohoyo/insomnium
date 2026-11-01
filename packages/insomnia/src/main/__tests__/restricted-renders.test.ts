import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { globalBeforeEach } from '../../__jest__/before-each';
import { render } from '../../templating';
import { restrictRenders } from '../restricted-renders';

describe('restrictRenders()', () => {
  let file: string;

  beforeEach(async () => {
    await globalBeforeEach();
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'restricted-renders-')), 'secret.txt');
    fs.writeFileSync(file, 'the secret');
  });
  afterEach(() => {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it("leaves the file tag out of a restricted render, and only that one's", async () => {
    const template = `{% file '${file.replace(/\\/g, '\\\\')}' %}`;

    await expect(restrictRenders(() => render(template))).rejects.toThrow("can't read files for an MCP client");
    // through awaits too, as a tool's handler renders
    await expect(restrictRenders(async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return render(template);
    })).rejects.toThrow("can't read files");

    await expect(render(template)).resolves.toBe('the secret');
    await expect(restrictRenders(() => render('{% uuid %}'))).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });
});
