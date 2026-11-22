import fs from 'fs';
import React, { type FC, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { OverlayContainer } from 'react-aria';

import { customPayloads, FUZZ_LISTS, type FuzzMode, fuzzPlanSize, type FuzzPoint } from '../../../common/fuzz';
import { t } from '../../../common/i18n';
import { isSafeToRepeat } from '../../../common/security-tests';
import { fuzzCsv, fuzzJson } from '../../../network/fuzz-report';
import { FUZZ_MAX_ATTEMPTS, type FuzzAttemptResult, type FuzzRunSummary, listFuzzPoints, runFuzz } from '../../../network/fuzz-run';
import { Modal, type ModalHandle, type ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';

interface Props {
  request: { _id: string; name: string; method: string };
  // (the run's: replaced in tests)
  list?: typeof listFuzzPoints;
  run?: typeof runFuzz;
}

const shown = (payload: string) => payload.length > 80 ? `${payload.slice(0, 77)}… (${payload.length} characters)` : payload;

const AttemptRow: FC<{ attempt: FuzzAttemptResult }> = ({ attempt }) => {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr
        className={`cursor-pointer ${attempt.notable ? 'font-bold' : ''}`}
        data-testid={`fuzz-attempt-${attempt.index}`}
        onClick={() => setOpen(!open)}
      >
        <td className="faint">{attempt.index}</td>
        <td>{attempt.position}</td>
        <td><code className="txt-sm">{shown(attempt.payload)}</code></td>
        <td className={attempt.statusCode >= 500 ? 'danger' : attempt.statusCode >= 400 ? 'warning' : ''}>{attempt.statusCode || '—'}</td>
        <td>{attempt.bytes}</td>
        <td>{Math.round(attempt.elapsed)}</td>
        <td className={attempt.notable ? 'warning' : 'faint'}>
          {attempt.error ? <span className="danger">{attempt.error}</span> : attempt.flags.map(({ label }) => label).join('; ')}
        </td>
      </tr>
      {open ? (
        <tr>
          <td />
          <td colSpan={6}>
            <pre className="selectable txt-sm whitespace-pre-wrap break-words m-0" aria-label={t('The start of the answer to attempt {index}', { index: attempt.index })}>
              {attempt.snippet || t('(no body)')}
            </pre>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
};

// Fuzzing one request (common/fuzz.ts): choose where the payloads go and which
// ones, see how many requests that is, and send them. The request's scripts
// run for every attempt, so they can sign what's sent, say what counts, and
// clean up after an attempt that made something.
export const FuzzModal: FC<ModalProps & Props> = ({ request, onHide, list = listFuzzPoints, run = runFuzz }) => {
  const modalRef = useRef<ModalHandle>(null);
  const [points, setPoints] = useState<FuzzPoint[]>();
  const [chosenPoints, setChosenPoints] = useState<Set<string>>(new Set());
  const [chosenLists, setChosenLists] = useState<Set<string>>(new Set(['sql', 'types', 'fields']));
  const [custom, setCustom] = useState('');
  const [delay, setDelay] = useState(0);
  const [mode, setMode] = useState<FuzzMode>('one');
  const [allowed, setAllowed] = useState(false);
  const [attempts, setAttempts] = useState<FuzzAttemptResult[]>([]);
  const [summary, setSummary] = useState<FuzzRunSummary>();
  const [running, setRunning] = useState(false);
  const [onlyNotable, setOnlyNotable] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController>();

  useEffect(() => {
    modalRef.current?.show();
    list(request._id)
      .then(({ points: found }) => {
        setPoints(found);
        setChosenPoints(new Set(found.filter(point => point.suggested).map(({ id }) => id)));
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [list, request._id]);

  const payloads = useMemo(
    () => [...FUZZ_LISTS.filter(({ id }) => chosenLists.has(id)).flatMap(({ payloads: listed }) => listed), ...customPayloads(custom)],
    [chosenLists, custom],
  );
  const planned = useMemo(
    () => Math.min(FUZZ_MAX_ATTEMPTS, fuzzPlanSize((points || []).filter(({ id }) => chosenPoints.has(id)), payloads, mode)),
    [points, chosenPoints, payloads, mode],
  );
  // a request that changes things changes them once for every attempt
  const writes = !isSafeToRepeat(request.method);
  const started = running || attempts.length > 0;

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) {
      next.add(id);
    }
    return next;
  };

  const start = async () => {
    controller.current = new AbortController();
    setAttempts([]);
    setSummary(undefined);
    setError('');
    setRunning(true);
    try {
      const done = await run(request._id, {
        pointIds: [...chosenPoints],
        payloads,
        mode,
        delay,
        signal: controller.current.signal,
        onAttempt: attempt => setAttempts(sent => [...sent, attempt]),
      });
      setSummary(done);
      setOnlyNotable(done.notable > 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setRunning(false);
  };

  const save = async (kind: 'csv' | 'json') => {
    if (!summary) {
      return;
    }
    const { canceled, filePath } = await window.dialog.showSaveDialog({
      title: kind === 'csv' ? 'Save CSV' : 'Save JSON',
      buttonLabel: 'Save',
      defaultPath: `${request.name.replace(/[\\/:*?"<>|]/g, '-')}-fuzz.${kind}`,
    });
    if (canceled || !filePath) {
      return;
    }
    await fs.promises.writeFile(filePath, kind === 'csv' ? fuzzCsv(summary) : fuzzJson(summary, request.name));
  };

  // closing it stops the run
  const hide = () => {
    controller.current?.abort();
    onHide?.();
  };

  const visible = onlyNotable ? attempts.filter(({ notable }) => notable) : attempts;

  return (
    <OverlayContainer onClick={e => e.stopPropagation()}>
      <Modal ref={modalRef} onHide={hide} wide tall>
        <ModalHeader>{t('Fuzz: {name}', { name: request.name })}</ModalHeader>
        <ModalBody className="pad">
          {/* clear of the scroll bar */}
          <div className="pr-6">
          {!started && (
            <>
              <p className="faint txt-sm no-margin-top">
                {t("Sends this request many times, each with one value swapped for a payload, and compares the answers with the request's own. Its scripts run for every attempt, with fuzzPayload, fuzzPosition and fuzzAttempt as variables: an after-response script's failed test marks an attempt, and it can clean up what an attempt made. Nothing sent is kept.")}
                {' '}
                <strong className="warning">{t("Run it only against an API you're allowed to test.")}</strong>
              </p>
              <div className="flex gap-10 items-start mt-4">
                <fieldset className="flex-1 border-0 p-0 m-0 min-w-0">
                  <legend className="font-bold p-0 mb-3">{t('Where')}</legend>
                  {!points && !error ? <p className="faint txt-sm">{t('Reading the request…')}</p> : null}
                  {points && !points.length ? <p className="faint txt-sm">{t('This request has no values to put a payload in.')}</p> : null}
                  <ul aria-label={t('Positions')} className="list-none m-0 p-0 pr-2 flex flex-col gap-2 max-h-[16rem] overflow-y-auto">
                    {(points || []).map(point => (
                      <li key={point.id}>
                        <label className="flex items-center gap-3 txt-sm cursor-pointer">
                          <input type="checkbox" className="m-0 flex-shrink-0" checked={chosenPoints.has(point.id)} onChange={() => setChosenPoints(toggle(chosenPoints, point.id))} />
                          <span className="truncate" title={point.original}>{point.label}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
                <fieldset className="flex-1 border-0 p-0 m-0 min-w-0">
                  <legend className="font-bold p-0 mb-3">{t('With')}</legend>
                  <ul aria-label={t('Payload lists')} className="list-none m-0 p-0 flex flex-col gap-2">
                    {FUZZ_LISTS.map(({ id, name, about, payloads: listed }) => (
                      <li key={id}>
                        <label className="flex items-center gap-3 txt-sm cursor-pointer" title={about}>
                          <input type="checkbox" className="m-0 flex-shrink-0" checked={chosenLists.has(id)} onChange={() => setChosenLists(toggle(chosenLists, id))} />
                          <span>{name}</span>
                          <span className="faint">{listed.length}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <label className="txt-sm flex flex-col gap-2 mt-5">
                    {t('Your own, one a line (name=value adds a field to a JSON body)')}
                    <textarea className="input-box w-full font-mono txt-sm p-2 m-0" rows={3} value={custom} onChange={event => setCustom(event.currentTarget.value)} />
                  </label>
                  <label className="flex items-center gap-3 txt-sm mt-4" title={t('One at a time shows which input is at fault. All at once puts each payload in every position together. Every combination tries each mix of payloads over the positions, and grows fast.')}>
                    {t('Positions:')}
                    <select className="input-box m-0" value={mode} onChange={event => setMode(event.currentTarget.value as FuzzMode)}>
                      <option value="one">{t('One at a time')}</option>
                      <option value="together">{t('All at once')}</option>
                      <option value="combinations">{t('Every combination')}</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-3 txt-sm mt-4">
                    {t('Milliseconds between attempts')}
                    <input type="number" className="input-box w-24 m-0 px-2 py-1" min={0} value={delay} onChange={event => setDelay(Math.max(0, Number(event.currentTarget.value) || 0))} />
                  </label>
                </fieldset>
              </div>
              <p data-testid="fuzz-plan" className="mt-6 mb-3">
                {t('{count, plural, one {# attempt} other {# attempts}}, and the request once as it is.', { count: planned })}
                {planned >= FUZZ_MAX_ATTEMPTS ? ` ${t('A run sends {max} at most.', { max: FUZZ_MAX_ATTEMPTS })}` : ''}
              </p>
              {writes ? (
                <label className="notice warning flex items-start gap-3 txt-sm text-left p-3 cursor-pointer">
                  <input type="checkbox" className="m-0 mt-1 flex-shrink-0" checked={allowed} onChange={event => setAllowed(event.currentTarget.checked)} />
                  <span>
                    {t('This is a {method}: every attempt may change data on the server. I am allowed to test this API, and what the attempts make or change can be put right.', { method: request.method })}
                  </span>
                </label>
              ) : null}
            </>
          )}
          {error && <p className="notice error">{error}</p>}
          {started && (
            <section>
              <p data-testid="fuzz-summary" className={summary ? (summary.notable ? 'warning' : 'success') : 'faint'}>
                {summary
                  ? `${summary.notable ? t('{count, plural, one {# attempt is} other {# attempts are}} worth a look', { count: summary.notable }) : t('Nothing stood out')} · ${t('{count, plural, one {# request sent} other {# requests sent}}', { count: summary.requests })} · ${t('the request itself got {status}', { status: summary.baseline.statusCode || summary.baseline.error || t('no answer') })}${summary.stopped ? ` · ${t('stopped')}` : ''}`
                  : t('Sending: {done} of {total}', { done: attempts.length, total: planned })}
              </p>
              <label className="flex items-center gap-3 txt-sm my-3 cursor-pointer">
                <input type="checkbox" className="m-0 flex-shrink-0" checked={onlyNotable} onChange={event => setOnlyNotable(event.currentTarget.checked)} />
                {t('Only those worth a look')}
              </label>
              <table className="table--fancy table--striped table--compact w-full txt-sm" aria-label={t('Fuzz attempts')}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('Where')}</th>
                    <th>{t('Payload')}</th>
                    <th>{t('Status')}</th>
                    <th>{t('Bytes')}</th>
                    <th>ms</th>
                    <th>{t('What it showed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(attempt => <AttemptRow key={attempt.index} attempt={attempt} />)}
                </tbody>
              </table>
              {summary ? (
                <p className="faint txt-sm margin-top-sm">
                  {t("An attempt that stood out is a place to look, not a proven fault; one that didn't found nothing this once.")}
                </p>
              ) : null}
            </section>
          )}
        </div>
        </ModalBody>
        <ModalFooter>
          <div className="margin-left flex gap-2">
            {summary ? (
              <>
                <button className="btn btn--compact modal__footer-secondary" onClick={() => save('csv')}>Save CSV</button>
                <button className="btn btn--compact modal__footer-secondary" onClick={() => save('json')}>Save JSON</button>
                <button
                  className="btn btn--compact modal__footer-secondary"
                  onClick={() => {
 setAttempts([]); setSummary(undefined);
}}
                >{t('Change What Is Sent')}</button>
              </>
            ) : null}
          </div>
          {running
            ? <button className="btn" onClick={() => controller.current?.abort()}>{t('Stop')}</button>
            : (
              <button className="btn" disabled={!planned || (writes && !allowed)} onClick={start}>
                {t('Send {count} Requests', { count: planned + 1 })}
              </button>
            )}
        </ModalFooter>
      </Modal>
    </OverlayContainer>
  );
};
