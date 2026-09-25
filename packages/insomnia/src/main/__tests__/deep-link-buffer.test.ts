import { describe, expect, it, jest } from '@jest/globals';

import { createDeepLinkBuffer, linksFromArgv } from '../deep-link-buffer';

describe('linksFromArgv()', () => {
  it('keeps only arguments with the scheme, each on its own', () => {
    expect(linksFromArgv(['--no-sandbox', 'insomnia://app/alert?title=a', 'main.min.js'], 'insomnia://'))
      .toEqual(['insomnia://app/alert?title=a']);
    expect(linksFromArgv(['--inspect=0', '.'], 'insomnia://')).toEqual([]);
    expect(linksFromArgv(['insomnia://app/alert'], 'insomniadev://')).toEqual([]);
  });
});

describe('createDeepLinkBuffer()', () => {
  it('holds links until flushed, then delivers them in order', () => {
    const deliver = jest.fn();
    const buffer = createDeepLinkBuffer(deliver);

    buffer.push('insomnia://app/import?uri=a');
    buffer.push('insomnia://app/import?uri=b');
    expect(deliver).not.toHaveBeenCalled();

    buffer.flush();
    expect(deliver.mock.calls).toEqual([
      ['insomnia://app/import?uri=a'],
      ['insomnia://app/import?uri=b'],
    ]);
  });

  it('delivers links straight away once flushed', () => {
    const deliver = jest.fn();
    const buffer = createDeepLinkBuffer(deliver);

    buffer.flush();
    expect(deliver).not.toHaveBeenCalled();

    buffer.push('insomnia://app/alert?title=hi');
    expect(deliver).toHaveBeenCalledWith('insomnia://app/alert?title=hi');

    buffer.flush();
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
