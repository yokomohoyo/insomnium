import React, { type FC, useEffect, useRef, useState } from 'react';

import { t } from '../../../common/i18n';
import { isSafeToRepeat, SECURITY_TEST_MAX_REQUESTS, type SecurityCheckOutcome, type SecurityTestResult } from '../../../common/security-tests';
import { runRequestSecurityTests, type SecurityTestOptions } from '../../../network/security-tests';
import { showModal } from '../modals';
import { AskModal } from '../modals/ask-modal';
import { SecurityFindingList } from './response-security-viewer';

const OUTCOME_ICONS: Record<SecurityCheckOutcome, string> = {
  found: 'fa-circle-exclamation warning',
  passed: 'fa-circle-check success',
  skipped: 'fa-circle-minus faint',
  unclear: 'fa-circle-question info',
};
const outcomeLabel = (outcome: SecurityCheckOutcome) => ({ found: t('Found'), passed: t('Passed'), skipped: t('Not run'), unclear: t('Unclear') })[outcome];

interface Run {
  result?: SecurityTestResult;
  error?: string;
}
// each request's last run, for as long as the app is open and the request is
// as it was: nothing sent by the tests is kept, so neither is what they found
const runs = new Map<string, Run & { modified?: number }>();

interface Props {
  request: { _id: string; method: string; modified?: number };
  // the workspace's other environments, to send the request as another user
  environments: { _id: string; name: string }[];
  // (the tests': replaced in tests)
  run?: (requestId: string, options: SecurityTestOptions) => Promise<SecurityTestResult>;
  // asks before anything is sent; resolves true to go on
  confirm?: (requests: number) => Promise<boolean>;
}

const askFirst = (requests: number) => new Promise<boolean>(resolve => showModal(AskModal, {
  title: t('Run Security Tests'),
  message: t("This sends the request again up to {count} times, changed a little each time: without its credentials, with a quote in a parameter, several times in a row. Run it only against an API you're allowed to test.", { count: requests }),
  yesText: t('Run the Tests'),
  noText: t('Cancel'),
  onDone: async (yes: boolean) => resolve(yes),
}));

// Tries the API for what one response can't show (common/security-tests.ts),
// when the user asks, and after they've agreed to what it sends
export const SecurityTestsPanel: FC<Props> = ({ request, environments, run = runRequestSecurityTests, confirm = askFirst }) => {
  const [, redraw] = useState(0);
  const [running, setRunning] = useState<AbortController>();
  const [otherEnvironmentId, setOtherEnvironmentId] = useState('');
  const requestId = useRef(request._id);
  requestId.current = request._id;
  // a run doesn't outlive the request being looked at
  useEffect(() => () => running?.abort(), [running]);
  useEffect(() => {
    setOtherEnvironmentId('');
    setRunning(undefined);
  }, [request._id]);

  const safe = isSafeToRepeat(request.method);
  // (what an edited request's tests found was about another request)
  const kept = runs.get(request._id);
  const last = kept && kept.modified === request.modified ? kept : undefined;

  const start = async () => {
    if (!await confirm(SECURITY_TEST_MAX_REQUESTS)) {
      return;
    }
    const { _id: id, modified } = request;
    const controller = new AbortController();
    setRunning(controller);
    let outcome: Run;
    try {
      outcome = { result: await run(id, { otherEnvironmentId: otherEnvironmentId || null, signal: controller.signal }) };
    } catch (err) {
      outcome = { error: err instanceof Error ? err.message : String(err) };
    }
    runs.set(id, { ...outcome, modified });
    if (requestId.current === id) {
      setRunning(current => current === controller ? undefined : current);
      redraw(count => count + 1);
    }
  };

  return (
    <section aria-label={t('Security tests')} className="margin-top">
      <hr />
      <h3 className="txt-md margin-top-sm">{t('Tests')}</h3>
      <p className="txt-sm faint">
        {safe
          ? t("Sends this request again, changed a little each time, to see what the API does: without its credentials, with a token it shouldn't accept, as another user, from another site, over plain http, with a quote in a parameter, and several times in a row. Nothing they send is kept.")
          : t('Only a GET or HEAD request is tested: a {method} would change things once more for every test.', { method: request.method })}
      </p>
      {safe ? (
        <div className="flex items-center gap-2 margin-top-sm">
          <button className="btn btn--clicky" disabled={Boolean(running)} onClick={start}>
            {running ? <><i className="fa fa-spinner fa-spin" aria-hidden /> {t('Running…')}</> : t('Run Security Tests')}
          </button>
          {running ? <button className="btn btn--clicky" onClick={() => running.abort()}>{t('Stop')}</button> : null}
          {environments.length ? (
            <label className="flex items-center gap-2 txt-sm">
              {t('As another user:')}
              <select
                className="input-box"
                disabled={Boolean(running)}
                value={otherEnvironmentId}
                onChange={event => setOtherEnvironmentId(event.currentTarget.value)}
              >
                <option value="">{t('Not tested')}</option>
                {environments.map(({ _id, name }) => <option key={_id} value={_id}>{name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      {!running && last?.error ? <p className="danger txt-sm margin-top-sm">{t('The tests could not run: {error}', { error: last.error })}</p> : null}
      {!running && last?.result ? (
        <div className="margin-top-sm">
          {last.result.findings.length ? <SecurityFindingList findings={last.result.findings} label={t('Security test findings')} /> : null}
          <ul aria-label={t('Security tests run')} className="list-none m-0 p-0">
            {last.result.checks.map(check => (
              <li key={check.id} className="flex items-start gap-2 py-1 txt-sm" data-testid={`security-check-${check.id}`}>
                <i className={`fa ${OUTCOME_ICONS[check.outcome]}`} aria-hidden />
                <div className="selectable">
                  <strong>{check.title}</strong>
                  <span className="faint margin-left-sm">{outcomeLabel(check.outcome)}</span>
                  <div className="faint">{check.note}</div>
                </div>
              </li>
            ))}
          </ul>
          <p className="faint txt-sm margin-top-sm">
            {t('{count} requests were sent. A test that passed found nothing this once; it does not show the API is secure.', { count: last.result.requests })}
          </p>
        </div>
      ) : null}
    </section>
  );
};
