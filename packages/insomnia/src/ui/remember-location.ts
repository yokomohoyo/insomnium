import { matchPath } from 'react-router-dom';

interface Router {
  subscribe: (listener: (state: { location: { pathname: string } }) => void) => () => void;
}

/**
 * Keeps the window's location, for the next launch to open it again. Only
 * when it has changed: the router tells its subscribers of every change of its
 * state (each fetcher's, each revalidation's), many times for a keystroke.
 */
export function rememberLocation(router: Router, storage: Pick<Storage, 'setItem'> = localStorage) {
  let last = '';
  return router.subscribe(({ location }) => {
    if (location.pathname === last) {
      return;
    }
    last = location.pathname;
    const match = matchPath(
      {
        path: '/organization/:organizationId',
        end: false,
      },
      location.pathname
    );

    if (match?.params.organizationId) {
      storage.setItem('requester_locationHistoryEntry', location.pathname);
    }
    storage.setItem('locationHistoryEntry', location.pathname);
    match?.params.organizationId && storage.setItem(`locationHistoryEntry:${match?.params.organizationId}`, location.pathname);
    console.log('location.pathname', location.pathname);
  });
}
