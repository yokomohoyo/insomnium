import type { WebContents } from 'electron';

/**
 * Holds deep link URLs until a renderer is listening for 'shell:open'.
 *
 * On macOS a link that cold-starts the app arrives via 'open-url' before 'ready',
 * long before there is a window, and a message sent to a renderer that has not
 * registered its listener yet is dropped. The same goes for a window that is still
 * loading, such as one opened for a link because all windows were closed, or one
 * that is reloading, so readiness is tracked per target (a window's webContents).
 */
export const createDeepLinkBuffer = <T extends object>(deliver: (target: T, url: string) => void) => {
  const listening = new WeakSet<T>();
  // A null target stands for the first target that is ready, for links that came before any window
  let pending: { url: string; target: T | null }[] = [];
  // Delivers target's held links in order; true if there were any
  const drain = (target: T) => {
    const due = pending.filter(link => link.target === target || link.target === null);
    pending = pending.filter(link => !due.includes(link));
    due.forEach(link => deliver(target, link.url));
    return due.length > 0;
  };
  return {
    // target is where the link should open, or null if there is no window yet
    push: (url: string, target: T | null) => {
      pending.push({ url, target });
      if (target && listening.has(target)) {
        drain(target);
      }
    },
    // Call when target's renderer is listening; it gets the links held for it
    ready: (target: T) => {
      listening.add(target);
      return drain(target);
    },
    // Call when target's page goes away; its links are held until it is ready again
    unready: (target: T) => {
      listening.delete(target);
    },
    // Call when target is closed; its held links are dropped rather than turning up
    // later in an unrelated window
    discard: (target: T) => {
      listening.delete(target);
      pending = pending.filter(link => link.target !== target);
    },
  };
};

// The app's buffer, shared by everything in the main process that sends 'shell:open'
export const deepLinks = createDeepLinkBuffer((contents: WebContents, url) => contents.send('shell:open', url));

/**
 * Picks the deep links out of a command line. Launchers can put switches next to
 * the URL (the AppImage and snap builds add --no-sandbox before it), and the
 * renderer expects one URL per 'shell:open'.
 */
export const linksFromArgv = (argv: string[], scheme: string) =>
  argv.filter(arg => arg.startsWith(scheme));
