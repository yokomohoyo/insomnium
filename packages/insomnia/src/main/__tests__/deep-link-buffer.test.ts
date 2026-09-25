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
  const first = { id: 1 };
  const second = { id: 2 };

  it('holds links until a target is ready, then delivers them in order', () => {
    const deliver = jest.fn();
    const buffer = createDeepLinkBuffer(deliver);

    buffer.push('insomnia://app/import?uri=a', null);
    buffer.push('insomnia://app/import?uri=b', first);
    expect(deliver).not.toHaveBeenCalled();

    buffer.ready(first);
    expect(deliver.mock.calls).toEqual([
      [first, 'insomnia://app/import?uri=a'],
      [first, 'insomnia://app/import?uri=b'],
    ]);
  });

  it('delivers links for a ready target straight away, and only once', () => {
    const deliver = jest.fn();
    const buffer = createDeepLinkBuffer(deliver);

    buffer.ready(first);
    expect(deliver).not.toHaveBeenCalled();

    buffer.push('insomnia://app/alert?title=hi', first);
    expect(deliver).toHaveBeenCalledWith(first, 'insomnia://app/alert?title=hi');

    buffer.ready(first);
    buffer.ready(second);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('holds links for a target that is not ready yet, such as a new window', () => {
    const deliver = jest.fn();
    const buffer = createDeepLinkBuffer(deliver);
    buffer.ready(first);

    buffer.push('insomnia://app/alert?title=new', second);
    expect(deliver).not.toHaveBeenCalled();

    buffer.ready(second);
    expect(deliver.mock.calls).toEqual([[second, 'insomnia://app/alert?title=new']]);
  });

  it('holds links again while a ready target reloads', () => {
    const deliver = jest.fn();
    const buffer = createDeepLinkBuffer(deliver);
    buffer.ready(first);

    buffer.unready(first);
    buffer.push('insomnia://app/alert?title=reload', first);
    expect(deliver).not.toHaveBeenCalled();

    buffer.ready(first);
    expect(deliver.mock.calls).toEqual([[first, 'insomnia://app/alert?title=reload']]);
  });

  it('gives a target only its own links and those held before there was a window', () => {
    const deliver = jest.fn();
    const buffer = createDeepLinkBuffer(deliver);

    buffer.push('insomnia://app/alert?title=first', first);
    buffer.push('insomnia://app/alert?title=second', second);
    buffer.push('insomnia://app/alert?title=any', null);
    expect(buffer.ready(first)).toBe(true);
    expect(deliver.mock.calls).toEqual([
      [first, 'insomnia://app/alert?title=first'],
      [first, 'insomnia://app/alert?title=any'],
    ]);

    expect(buffer.ready(second)).toBe(true);
    expect(buffer.ready(first)).toBe(false);
    expect(deliver.mock.calls.slice(2)).toEqual([[second, 'insomnia://app/alert?title=second']]);
  });

  it('drops the links of a discarded target', () => {
    const deliver = jest.fn();
    const buffer = createDeepLinkBuffer(deliver);

    buffer.push('insomnia://app/alert?title=closed', first);
    buffer.push('insomnia://app/alert?title=any', null);
    buffer.discard(first);
    buffer.ready(second);
    expect(deliver.mock.calls).toEqual([[second, 'insomnia://app/alert?title=any']]);
  });
});
