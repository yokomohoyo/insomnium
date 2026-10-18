import React, { FC, useCallback, useEffect, useState } from 'react';

import { describeByteSize } from '../../../common/misc';
import type { Snapshot } from '../../../main/snapshots';
import { showModal } from '../modals';
import { AskModal } from '../modals/ask-modal';

// The snapshot's reason, from its name: 2026-10-18T09-30-00Z-before-restore.sqlite
const reasonOf = (name: string) => {
  const reason = name.replace(/\.sqlite$/, '').match(/Z-(.+)$/)?.[1];
  return reason === 'manual' ? 'taken by hand' : reason === 'before-restore' ? 'before a restore' : reason || '';
};

// The daily copies of all the data (main/snapshots.ts), and restoring one
export const Snapshots: FC = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>();
  const [error, setError] = useState('');
  const [taking, setTaking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSnapshots(await window.main.listSnapshots());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const take = async () => {
    setTaking(true);
    setError('');
    try {
      await window.main.takeSnapshot();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTaking(false);
    }
  };

  const restore = (snapshot: Snapshot) => showModal(AskModal, {
    title: 'Restore Snapshot',
    message: `Insomnium will restart with all your data as it was on ${new Date(snapshot.created).toLocaleString()}. What's there now is kept as a snapshot first, so you can go back to it.`,
    yesText: 'Restart and Restore',
    noText: 'Cancel',
    onDone: async (yes: boolean) => {
      if (yes) {
        await window.main.restoreSnapshot(snapshot.name).catch(err => setError(err.message));
      }
    },
  });

  return (
    <section aria-label="Snapshots" className="margin-top">
      <h2>Snapshots</h2>
      <p className="faint txt-sm">
        While it runs, Insomnium copies all your data once a day and keeps the last seven, so a deleted workspace or a bad import can be undone.
        Restoring one replaces everything with that copy. The copies stay on this computer.
      </p>
      {error && <p className="notice error">{error}</p>}
      {snapshots && !snapshots.length && <p className="faint">None yet.</p>}
      <ul aria-label="Snapshots taken" className="list-none m-0 p-0">
        {snapshots?.map(snapshot => (
          <li key={snapshot.name} className="flex items-center gap-2 pad-bottom-sm">
            <span className="flex-1">
              {new Date(snapshot.created).toLocaleString()}
              {reasonOf(snapshot.name) && <span className="faint"> · {reasonOf(snapshot.name)}</span>}
            </span>
            <span className="faint txt-sm">{describeByteSize(snapshot.size)}</span>
            <button className="btn btn--clicky btn--compact" onClick={() => restore(snapshot)}>Restore</button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button className="btn btn--clicky btn--compact" disabled={taking} onClick={take}>Take One Now</button>
        <button className="btn btn--clicky btn--compact" onClick={() => window.main.showSnapshotsFolder()}>Show Folder</button>
      </div>
    </section>
  );
};
