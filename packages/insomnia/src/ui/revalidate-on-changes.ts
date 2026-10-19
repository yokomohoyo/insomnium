import type { createMemoryRouter } from 'react-router-dom';

import { type ChangeBufferEvent, database } from '../common/database';

type Router = ReturnType<typeof createMemoryRouter>;

// What the routes' loaders show; Response/Stats/*Meta excluded to avoid Send-loop.
export const REVALIDATE_TYPES = new Set([
  'Workspace', 'Project', 'Request', 'RequestGroup', 'Environment',
  'GrpcRequest', 'WebSocketRequest', 'McpRequest', 'ApiSpec', 'ProtoFile', 'ProtoDirectory',
]);

// A window's navigation, or a fetcher's action (submitting, then loading what
// it changed), under way. Not a fetcher's plain load: a revalidation loads it
// again with the rest. And a dialog's, whose component has gone, can stay
// 'loading' for good once a revalidation interrupts it, as React Router
// neither loads it again nor drops it, which would hold every change back.
const busy = (router: Router) =>
  router.state.navigation.state !== 'idle'
  || [...router.state.fetchers.values()].some(fetcher => fetcher.state === 'submitting' || (fetcher.state === 'loading' && fetcher.formMethod !== undefined));

/**
 * Revalidates a window's routes when the database changes what they show (an
 * MCP client's write, another window's, the window's own), but not while its
 * own navigation or action is under way. React Router revalidates after an
 * action anyway, and a revalidation begun meanwhile makes it drop the action's
 * redirect: the change of a write arrives before its action finishes, so a
 * request just created (or duplicated) wouldn't open. What changes meanwhile
 * is revalidated once the window is idle. Returns the unsubscribe.
 */
export function revalidateOnDatabaseChanges(router: Router, db: Pick<typeof database, 'onChange' | 'offChange'> = database) {
  let pending = false;
  const listener = (changes: ChangeBufferEvent[]) => {
    if (!changes.some(([, doc]) => REVALIDATE_TYPES.has(doc.type))) {
      return;
    }
    if (busy(router)) {
      pending = true;
      return;
    }
    router.revalidate();
  };
  const unsubscribe = router.subscribe(() => {
    if (pending && !busy(router)) {
      pending = false;
      // not from inside the router's own state update
      queueMicrotask(() => router.revalidate());
    }
  });
  db.onChange(listener);
  return () => {
    db.offChange(listener);
    unsubscribe();
  };
}
