import React, { type FC, useEffect, useMemo, useRef, useState } from 'react';
import { OverlayContainer } from 'react-aria';

import { t } from '../../../common/i18n';
import { comparable, type DiffLine, diffLines, diffWithContext } from '../../../common/text-diff';
import * as models from '../../../models';
import type { Response } from '../../../models/response';
import { Modal, type ModalHandle, type ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';

// as much of each body as is compared
const BODY_BYTES = 1024 * 1024;

type Compared = Pick<Response, '_id' | 'statusCode' | 'statusMessage' | 'elapsedTime' | 'bytesRead' | 'bytesContent' | 'headers' | 'created' | 'bodyPath' | 'bodyCompression'>;

interface Props {
  // the request's responses, newest first
  responses: Compared[];
  // the one being looked at: compared with the one before it
  activeResponseId?: string;
  // (the bodies': replaced in tests)
  readBody?: (response: Compared) => Promise<{ text: string; truncated: boolean }>;
}

const readStored = async (response: Compared) => {
  const { buffer, truncated } = await models.response.getBoundedBodyBuffer(response, BODY_BYTES);
  return { text: buffer.toString('utf8'), truncated };
};

// "200 OK · 12 ms · 1.2 KB · 14:03:22"
const titleOf = ({ statusCode, statusMessage, elapsedTime, bytesContent, bytesRead, created }: Compared) =>
  `${statusCode}${statusMessage ? ` ${statusMessage}` : ''} · ${Math.round(elapsedTime)} ms · ${bytesContent || bytesRead} B · ${new Date(created).toLocaleString()}`;

// the headers as lines, in name order: the order a server sends them in says nothing
const headerLines = ({ headers }: Compared) => (headers || [])
  .map(({ name, value }) => `${name}: ${value}`)
  .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  .join('\n');

const MARKS: Record<DiffLine['kind'], string> = { same: ' ', removed: '-', added: '+' };
const ROW_CLASSES: Record<DiffLine['kind'], string> = { same: '', removed: 'bg-[rgba(var(--color-danger-rgb),0.15)]', added: 'bg-[rgba(var(--color-success-rgb),0.15)]' };

const Diff: FC<{ label: string; before: string; after: string; onlyChanges: boolean }> = ({ label, before, after, onlyChanges }) => {
  const diff = useMemo(() => diffLines(before, after), [before, after]);
  // each line with a key of its own: its place in the two texts, and for the
  // lines left out between two parts, the line they come after
  const shown = useMemo(() => {
    let last = 'start';
    return (onlyChanges ? diffWithContext(diff) : diff.lines).map(line => {
      last = line ? `${line.kind}:${line.left ?? ''}:${line.right ?? ''}` : `gap after ${last}`;
      return { line, key: last };
    });
  }, [diff, onlyChanges]);
  const same = !diff.added && !diff.removed;
  return (
    <section aria-label={label} className="mt-4">
      <h3 className="txt-md m-0 mb-2">
        {label}
        <span className={`txt-sm font-normal margin-left-sm ${same ? 'faint' : 'warning'}`} data-testid={`compare-count-${label}`}>
          {same ? t('the same') : t('{removed} only in the first, {added} only in the second', { removed: diff.removed, added: diff.added })}
        </span>
      </h3>
      {diff.tooLong ? <p className="faint txt-sm">{t('Too long to line up: the first is shown, then the second.')}</p> : null}
      {same && onlyChanges ? null : (
        <pre className="m-0 p-2 txt-sm font-mono overflow-x-auto border border-solid border-[--hl-md] rounded selectable max-h-[24rem] overflow-y-auto">
          {shown.map(({ line, key }) => line === null
            ? <div key={key} className="faint">⋯</div>
            : (
              <div key={key} className={ROW_CLASSES[line.kind]} data-kind={line.kind}>
                <span className="faint inline-block w-10 text-right select-none">{line.left ?? ''}</span>
                <span className="faint inline-block w-10 text-right select-none">{line.right ?? ''}</span>
                <span className="inline-block w-6 text-center select-none">{MARKS[line.kind]}</span>
                {line.text}
              </div>
            ))}
        </pre>
      )}
    </section>
  );
};

// Two of a request's responses side by side in one column: what the second
// has that the first hasn't, in the status, the headers and the body. For
// telling what a change to the request did to the answer.
export const CompareResponsesModal: FC<ModalProps & Props> = ({ responses, activeResponseId, onHide, readBody = readStored }) => {
  const modalRef = useRef<ModalHandle>(null);
  const active = Math.max(0, responses.findIndex(({ _id }) => _id === activeResponseId));
  // the one being looked at, against the one before it (or after, for the oldest)
  const [secondId, setSecondId] = useState(responses[active]?._id || '');
  const [firstId, setFirstId] = useState((responses[active + 1] || responses[active - 1] || responses[active])?._id || '');
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [bodies, setBodies] = useState<{ first: string; second: string; truncated: boolean }>();
  const [error, setError] = useState('');

  useEffect(() => {
    modalRef.current?.show();
  }, []);

  const first = responses.find(({ _id }) => _id === firstId);
  const second = responses.find(({ _id }) => _id === secondId);

  useEffect(() => {
    let stale = false;
    setBodies(undefined);
    setError('');
    if (first && second) {
      Promise.all([readBody(first), readBody(second)])
        .then(([a, b]) => stale || setBodies({ first: comparable(a.text), second: comparable(b.text), truncated: a.truncated || b.truncated }))
        .catch(err => stale || setError(err instanceof Error ? err.message : String(err)));
    }
    return () => {
      stale = true;
    };
  }, [first, second, readBody]);

  const choose = (label: string, value: string, onChange: (id: string) => void) => (
    <label className="txt-sm flex flex-col gap-2 flex-1 min-w-0">
      {label}
      <select className="input-box m-0 w-full" value={value} onChange={event => onChange(event.currentTarget.value)}>
        {responses.map(response => <option key={response._id} value={response._id}>{titleOf(response)}</option>)}
      </select>
    </label>
  );

  return (
    <OverlayContainer onClick={e => e.stopPropagation()}>
      <Modal ref={modalRef} onHide={onHide} wide>
        <ModalHeader>{t('Compare Responses')}</ModalHeader>
        <ModalBody className="pad">
          {/* clear of the scroll bar */}
          <div className="pr-6">
            <div className="flex gap-6 items-end">
              {choose(t('First'), firstId, setFirstId)}
              {choose(t('Second'), secondId, setSecondId)}
            </div>
            <label className="flex items-center gap-3 txt-sm mt-4 cursor-pointer">
              <input type="checkbox" className="m-0 flex-shrink-0" checked={onlyChanges} onChange={event => setOnlyChanges(event.currentTarget.checked)} />
              {t('Only what differs')}
            </label>
            {error ? <p className="notice error">{t('The responses could not be read: {error}', { error })}</p> : null}
            {first && second && firstId === secondId ? <p className="faint txt-sm mt-4">{t('That is the same response twice.')}</p> : null}
            {first && second ? (
              <>
                <Diff label={t('Status')} before={`${first.statusCode} ${first.statusMessage || ''}`.trim()} after={`${second.statusCode} ${second.statusMessage || ''}`.trim()} onlyChanges={false} />
                <Diff label={t('Headers')} before={headerLines(first)} after={headerLines(second)} onlyChanges={onlyChanges} />
                {bodies
                  ? <Diff label={t('Body')} before={bodies.first} after={bodies.second} onlyChanges={onlyChanges} />
                  : error ? null : <p className="faint txt-sm mt-4">{t('Reading the bodies…')}</p>}
                {bodies?.truncated ? <p className="faint txt-sm">{t('Only the first megabyte of each body is compared.')}</p> : null}
              </>
            ) : null}
          </div>
        </ModalBody>
        <ModalFooter>
          <button className="btn" onClick={() => modalRef.current?.hide()}>{t('Done')}</button>
        </ModalFooter>
      </Modal>
    </OverlayContainer>
  );
};
