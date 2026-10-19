import React, { FC, useEffect, useRef, useState } from 'react';
import { OverlayContainer } from 'react-aria';

import type { DocConflict, MergeChoice } from '../../../sync/git/merge-docs';
import { Modal, type ModalHandle, ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';

type Props = ModalProps & {
  // what's being merged in, for the title: a branch, or the remote's
  theirs: string;
  // what resolving does: Merge, Rebase, Apply
  actionLabel?: string;
  conflicts: DocConflict[];
  onResolve: (choices: Record<string, MergeChoice>) => void;
};

// The documents both sides of a merge or pull changed, with the fields that
// clash. Each keeps this side's fields or takes theirs; other changes from both
// sides merge either way.
export const GitConflictsModal: FC<Props> = ({ theirs, actionLabel = 'Merge', conflicts, onResolve, onHide }) => {
  const modalRef = useRef<ModalHandle>(null);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>(() =>
    Object.fromEntries(conflicts.map(conflict => [conflict.file, 'ours'])));

  useEffect(() => {
    modalRef.current?.show();
  }, []);

  return (
    <OverlayContainer>
      <Modal ref={modalRef} onHide={onHide}>
        <ModalHeader>Changed on Both Sides</ModalHeader>
        <ModalBody className="pad">
          <p>
            These changed here and in {theirs}. Choose which to keep for each; their other changes, and yours, are merged.
          </p>
          {conflicts.map(conflict => (
            <div key={conflict.file} className="pad-top" data-testid="git-conflict">
              <strong>{conflict.name || conflict.file}</strong>{conflict.type ? <span className="faint"> ({conflict.type})</span> : null}
              <table className="table--fancy table--outlined margin-top-sm">
                <thead>
                  <tr>
                    <th className="text-left">Field</th>
                    <th className="text-left">Yours</th>
                    <th className="text-left">Theirs</th>
                  </tr>
                </thead>
                <tbody>
                  {conflict.fields.map(field => (
                    <tr key={field.field}>
                      <td><code>{field.field}</code></td>
                      <td className="selectable">{field.ours ?? <span className="faint">(none)</span>}</td>
                      <td className="selectable">{field.theirs ?? <span className="faint">(none)</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-4 margin-top-sm">
                {(['ours', 'theirs'] as const).map(choice => (
                  <label key={choice} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name={`choice-${conflict.file}`}
                      checked={choices[conflict.file] === choice}
                      onChange={() => setChoices({ ...choices, [conflict.file]: choice })}
                    />
                    {choice === 'ours' ? 'Keep yours' : 'Take theirs'}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </ModalBody>
        <ModalFooter>
          <div>
            <button className="btn" onClick={() => modalRef.current?.hide()}>
              Cancel
            </button>
            <button
              className="btn"
              onClick={() => {
                onResolve(choices);
                modalRef.current?.hide();
              }}
            >
              {actionLabel}
            </button>
          </div>
        </ModalFooter>
      </Modal>
    </OverlayContainer>
  );
};
