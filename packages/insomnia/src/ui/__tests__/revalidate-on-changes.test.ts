/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import { createMemoryRouter, redirect } from 'react-router-dom';

import { revalidateOnDatabaseChanges, waitingOn } from '../revalidate-on-changes';

type Router = ReturnType<typeof createMemoryRouter>;
type Listener = (changes: any[]) => void;

// the database's change events, as a window gets them
const fakeDatabase = () => {
  const listeners = new Set<Listener>();
  return {
    onChange: (listener: Listener) => void listeners.add(listener),
    offChange: (listener: Listener) => void listeners.delete(listener),
    emit: (type: string) => listeners.forEach(listener => listener([['insert', { _id: 'x', type }, false]])),
  };
};

const settled = (router: Router) => new Promise<void>(resolve => {
  const done = () => router.state.navigation.state === 'idle'
    && router.state.revalidation === 'idle'
    && [...router.state.fetchers.values()].every(fetcher => fetcher.state === 'idle');
  const check = () => {
    if (done()) {
      unsubscribe();
      resolve();
    }
  };
  const unsubscribe = router.subscribe(() => setTimeout(check));
  setTimeout(check);
});
// gives up before the test's timeout, so that a failure doesn't leave it looking
const until = async (ready: () => unknown, milliseconds = 2000) => {
  const deadline = Date.now() + milliseconds;
  while (!ready()) {
    if (Date.now() > deadline) {
      throw new Error('never ready');
    }
    await new Promise(resolve => setTimeout(resolve, 1));
  }
};

// a window with a list, an action that creates an item and opens it (as a
// new request does), and a loader that counts its runs
const window = async () => {
  const state = { loads: 0, finishAction: undefined as (() => void) | undefined, finishLoad: undefined as (() => void) | undefined };
  const router = createMemoryRouter([{
    path: '/',
    id: 'root',
    loader: () => ++state.loads,
    children: [
      { path: 'list', loader: () => null },
      { path: 'item', loader: () => null },
      {
        path: 'new',
        action: async () => {
          await new Promise<void>(resolve => {
            state.finishAction = resolve;
          });
          return redirect('/item');
        },
      },
      {
        // slow the first time (a revalidation runs it again, for the fetcher)
        path: 'slow',
        loader: () => state.finishLoad ? null : new Promise<null>(resolve => {
          state.finishLoad = () => resolve(null);
        }),
      },
    ],
  }], { initialEntries: ['/list'] });
  await settled(router);
  return { router, state };
};

describe('revalidating on database changes', () => {
  it("keeps the redirect of an action whose write's change arrives before it finishes", async () => {
    const { router, state } = await window();
    const db = fakeDatabase();
    const stop = revalidateOnDatabaseChanges(router, db);

    router.fetch('create', 'root', '/new', { formMethod: 'post', formData: new FormData() });
    await until(() => state.finishAction);
    db.emit('Request');
    state.finishAction!();
    await settled(router);

    expect(router.state.location.pathname).toBe('/item');
    stop();
  });

  it('says what keeps the window busy', async () => {
    const { router, state } = await window();
    router.fetch('create', 'root', '/new', { formMethod: 'post', formData: new FormData() });
    await until(() => state.finishAction);
    expect(waitingOn(router)).toEqual({ navigation: 'idle', fetchers: [{ key: 'create', state: 'submitting', formMethod: 'POST', formAction: '/new' }] });
    state.finishAction!();
    await settled(router);
    expect(waitingOn(router).fetchers).toEqual([]);
  });

  it('(which a revalidation begun meanwhile would drop)', async () => {
    const { router, state } = await window();

    router.fetch('create', 'root', '/new', { formMethod: 'post', formData: new FormData() });
    await until(() => state.finishAction);
    router.revalidate();
    state.finishAction!();
    await settled(router);

    expect(router.state.location.pathname).toBe('/list');
  });

  it('revalidates at once when the window is idle, and only for what the routes show', async () => {
    const { router, state } = await window();
    const db = fakeDatabase();
    const stop = revalidateOnDatabaseChanges(router, db);
    const before = state.loads;

    db.emit('Response');
    await settled(router);
    expect(state.loads).toBe(before);

    db.emit('Request');
    await settled(router);
    expect(state.loads).toBe(before + 1);
    stop();
  });

  it("doesn't wait for a fetcher's load, which the revalidation loads again", async () => {
    const { router, state } = await window();
    const db = fakeDatabase();
    const stop = revalidateOnDatabaseChanges(router, db);

    router.fetch('load', 'root', '/slow');
    await until(() => state.finishLoad);
    const during = state.loads;
    db.emit('Workspace');
    await until(() => state.loads > during);
    state.finishLoad!();
    await settled(router);

    expect(state.loads).toBe(during + 1);
    // done, and dropped from the state as finished fetchers are
    expect(router.state.fetchers.get('load')?.state).not.toBe('loading');
    stop();
  });

  it("isn't held up by a closed dialog's load that a revalidation interrupted", async () => {
    const { router, state } = await window();
    const db = fakeDatabase();
    const stop = revalidateOnDatabaseChanges(router, db);

    // a dialog's fetcher, loading when the dialog closes, and a revalidation
    // then, which leaves it 'loading' for good (React Router 7 does)
    router.fetch('dialog', 'root', '/slow');
    await until(() => state.finishLoad);
    router.deleteFetcher('dialog');
    router.revalidate();
    await until(() => router.state.revalidation === 'idle');
    expect(router.state.fetchers.get('dialog')?.state).toBe('loading');

    const before = state.loads;
    db.emit('Request');
    await until(() => state.loads > before);
    await until(() => router.state.revalidation === 'idle');
    expect(state.loads).toBe(before + 1);
    stop();
  });
});
