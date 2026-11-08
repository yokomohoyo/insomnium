import { describe, expect, it, jest } from '@jest/globals';

import { debounceEdit, settleEdits, trackSave } from '../pending-edits';

describe('pending edits', () => {
  it('holds back an edit while typing goes on, then makes it once, with the last value', () => {
    jest.useFakeTimers();
    const saved: string[] = [];
    const edit = debounceEdit((value: string) => saved.push(value));
    edit.call('a');
    edit.call('ab');
    jest.advanceTimersByTime(50);
    expect(saved).toEqual([]);
    jest.advanceTimersByTime(100);
    expect(saved).toEqual(['ab']);
    jest.advanceTimersByTime(1000);
    expect(saved).toEqual(['ab']);
    jest.useRealTimers();
  });

  it('a send makes the held edits now, and waits for the saves on their way', async () => {
    const saved: string[] = [];
    let finish = () => {};
    const edit = debounceEdit((value: string) => {
      trackSave(new Promise<void>(resolve => {
        finish = () => {
          saved.push(value);
          resolve();
        };
      }));
    });
    edit.call('typed last');

    let settled = false;
    const send = settleEdits().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await send;
    expect(saved).toEqual(['typed last']);
  });

  it('flushing with nothing held changes nothing', () => {
    const saved: string[] = [];
    const edit = debounceEdit((value: string) => saved.push(value));
    edit.flush();
    expect(saved).toEqual([]);
  });
});
