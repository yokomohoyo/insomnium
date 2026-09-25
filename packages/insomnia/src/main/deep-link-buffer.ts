/**
 * Holds deep link URLs until the renderer is listening for 'shell:open'.
 *
 * On macOS a link that cold-starts the app arrives via 'open-url' before 'ready',
 * long before there is a window, and a message sent to a renderer that has not
 * registered its listener yet is dropped.
 */
export const createDeepLinkBuffer = (deliver: (url: string) => void) => {
  let pending: string[] | null = [];
  return {
    push: (url: string) => {
      if (pending) {
        pending.push(url);
      } else {
        deliver(url);
      }
    },
    // Call when the renderer is ready; delivers what was held and lets later links straight through
    flush: () => {
      const urls = pending || [];
      pending = null;
      urls.forEach(url => deliver(url));
    },
  };
};

/**
 * Picks the deep links out of a command line. Launchers can put switches next to
 * the URL (the AppImage and snap builds add --no-sandbox before it), and the
 * renderer expects one URL per 'shell:open'.
 */
export const linksFromArgv = (argv: string[], scheme: string) =>
  argv.filter(arg => arg.startsWith(scheme));
