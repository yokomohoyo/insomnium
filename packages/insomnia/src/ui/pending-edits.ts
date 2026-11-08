import { DEBOUNCE_MILLIS } from '../common/constants';

// Edits on their way to the database: those an editor holds back while
// someone types, and saves submitted but not done. A send waits for both,
// so it never sends what was there before the last keystroke.
const held = new Set<() => void>();
const saving = new Set<Promise<unknown>>();

// Like misc.debounce, but a send can have it go now
export const debounceEdit = <T>(callback: (value: T) => void, milliseconds = DEBOUNCE_MILLIS) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let value: T;
  const flush = () => {
    clearTimeout(timer);
    if (held.delete(flush)) {
      callback(value);
    }
  };
  const call = (next: T) => {
    value = next;
    clearTimeout(timer);
    held.add(flush);
    timer = setTimeout(flush, milliseconds);
  };
  return { call, flush };
};

export const trackSave = (save: Promise<unknown>) => {
  saving.add(save);
  save.finally(() => saving.delete(save));
};

export const settleEdits = async () => {
  [...held].forEach(flush => flush());
  await Promise.allSettled([...saving]);
};
