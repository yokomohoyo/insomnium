import type { createMemoryRouter } from 'react-router-dom';

import { type ChangeBufferEvent, database } from '../common/database';

type Router = ReturnType<typeof createMemoryRouter>;

// What the routes' loaders show; Response/Stats/*Meta excluded to avoid Send-loop.
export const REVALIDATE_TYPES = new Set([
  'Workspace', 'Project', 'Request', 'RequestGroup', 'Environment',
  'GrpcRequest', 'WebSocketRequest', 'McpRequest', 'ApiSpec', 'ProtoFile', 'ProtoDirectory',
  // the Flows tab's list, and an open flow changed elsewhere (over MCP, or by Git)
  'Flow',
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
 * is revalidated once the window is idle, unless an action's load (which
 * began after it) has read it. Returns the unsubscribe.
 */
export function revalidateOnDatabaseChanges(router: Router, db: Pick<typeof database, 'onChange' | 'offChange'> = database) {
  let pending = false;
  // The actions' loads under way when the last change came, and whether one
  // has begun since: that one reads the change (an action's own writes come
  // before it finishes), so it needn't be loaded again. Every save in the
  // window used to load all the routes twice.
  let loadingThen = new Set<string>();
  let loadedSince = false;
  // what the routes had loaded then: after a failed action (4xx, 5xx) React
  // Router goes through 'loading' without loading them
  let dataThen: Router['state']['loaderData'] | undefined;
  // a revalidation waiting this long says on what, in the window's console
  let slow: ReturnType<typeof setTimeout> | undefined;
  const listener = (changes: ChangeBufferEvent[]) => {
    if (!changes.some(([, doc]) => REVALIDATE_TYPES.has(doc.type))) {
      return;
    }
    if (busy(router)) {
      pending = true;
      loadedSince = false;
      loadingThen = actionLoads(router);
      dataThen = router.state.loaderData;
      slow ??= setTimeout(() => {
        slow = undefined;
        if (pending) {
          console.warn('[revalidate] waiting on', waitingOn(router));
        }
      }, SLOW);
      return;
    }
    router.revalidate();
  };
  const unsubscribe = router.subscribe(() => {
    if (pending && !loadedSince && [...actionLoads(router)].some(key => !loadingThen.has(key))) {
      loadedSince = true;
    }
    if (pending && !busy(router)) {
      pending = false;
      clearTimeout(slow);
      slow = undefined;
      // not from inside the router's own state update; and not when an
      // action's load (an action that failed with a 4xx or 5xx has none) read it
      // (a route's data is new once its loader has run: the root's settings, at least)
      const reloaded = !!dataThen && Object.keys(dataThen).some(id => router.state.loaderData[id] !== dataThen![id]);
      if (!loadedSince || !reloaded) {
        queueMicrotask(() => router.revalidate());
      }
    }
  });
  db.onChange(listener);
  return () => {
    db.offChange(listener);
    unsubscribe();
    clearTimeout(slow);
  };
}

const SLOW = 5000;

// the loads after an action (a fetcher's, or a submitting navigation's), which
// React Router makes of every route
const actionLoads = (router: Router) => {
  const keys = new Set<string>();
  for (const [key, fetcher] of router.state.fetchers) {
    if (fetcher.state === 'loading' && fetcher.formMethod !== undefined) {
      keys.add(key);
    }
  }
  const { navigation } = router.state;
  if (navigation.state === 'loading' && navigation.formMethod !== undefined) {
    keys.add(`navigation ${navigation.location.key}`);
  }
  return keys;
};

// what keeps the window busy: its navigation, and the fetchers not idle
export const waitingOn = (router: Router) => ({
  navigation: router.state.navigation.state,
  fetchers: [...router.state.fetchers]
    .filter(([, fetcher]) => fetcher.state !== 'idle')
    .map(([key, fetcher]) => ({ key, state: fetcher.state, formMethod: fetcher.formMethod, formAction: fetcher.formAction })),
});
