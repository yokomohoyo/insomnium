import React, { type FC, useEffect, useRef, useState } from 'react';

import { t } from '../../../common/i18n';
import { withoutIgnored } from '../../../common/security-rules';
import { isSafeToRepeat, RATE_LIMIT_MOST, RATE_LIMIT_REQUESTS, rateLimitBurst, type SecurityCheckOutcome, securityTestMaxRequests, type SecurityTestResult } from '../../../common/security-tests';
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

interface TestedRequest {
  _id: string;
  method: string;
  modified?: number;
}

// what a request's last run found, if it has been run as it is now
const lastRun = (request: TestedRequest) => {
  // (what an edited request's tests found was about another request)
  const kept = runs.get(request._id);
  return kept && kept.modified === request.modified ? kept : undefined;
};
export const securityTestFindings = (request: TestedRequest) => lastRun(request)?.result?.findings || [];

interface Props {
  request: TestedRequest;
  // marked as for some users only, itself or by a folder it's in: the
  // less-privilege test is the one that matters for it
  restricted?: boolean;
  // the rules this collection ignores, and the way to ignore another
  ignored?: string[];
  onIgnore?: (id: string) => void;
  // a run has finished: what securityTestFindings gives has changed
  onResult?: () => void;
  // the workspace's other environments, to send the request as another user
  environments: { _id: string; name: string }[];
  // (the tests': replaced in tests)
  run?: (requestId: string, options: SecurityTestOptions) => Promise<SecurityTestResult>;
  // asks before anything is sent; resolves true to go on
  confirm?: (requests: number) => Promise<boolean>;
}

const askFirst = (requests: number) => new Promise<boolean>(resolve => showModal(AskModal, {
  title: t('Run Security Tests'),
  message: t("This sends the request again up to {count} times, changed a little each time: without its credentials, with a quote in a parameter, many times in a row. Run it only against an API you're allowed to test.", { count: requests }),
  yesText: t('Run the Tests'),
  noText: t('Cancel'),
  onDone: async (yes: boolean) => resolve(yes),
}));

// Tries the API for what one response can't show (common/security-tests.ts),
// when the user asks, and after they've agreed to what it sends
export const SecurityTestsPanel: FC<Props> = ({ request, restricted, environments, ignored = [], onIgnore, onResult, run = runRequestSecurityTests, confirm = askFirst }) => {
  const [, redraw] = useState(0);
  const [running, setRunning] = useState<AbortController>();
  const [otherEnvironmentId, setOtherEnvironmentId] = useState('');
  const [lowerEnvironmentId, setLowerEnvironmentId] = useState('');
  const [rateLimitRequests, setRateLimitRequests] = useState(RATE_LIMIT_REQUESTS);
  const requestId = useRef(request._id);
  requestId.current = request._id;
  // a run doesn't outlive the request being looked at
  useEffect(() => () => running?.abort(), [running]);
  useEffect(() => {
    setOtherEnvironmentId('');
    setLowerEnvironmentId('');
    setRunning(undefined);
  }, [request._id]);

  const safe = isSafeToRepeat(request.method);
  const last = lastRun(request);
  const findings = withoutIgnored(last?.result?.findings || [], ignored);

  const start = async () => {
    if (!await confirm(securityTestMaxRequests(rateLimitRequests))) {
      return;
    }
    const { _id: id, modified } = request;
    const controller = new AbortController();
    setRunning(controller);
    let outcome: Run;
    try {
      outcome = { result: await run(id, { otherEnvironmentId: otherEnvironmentId || null, lowerEnvironmentId: lowerEnvironmentId || null, rateLimitRequests, signal: controller.signal }) };
    } catch (err) {
      outcome = { error: err instanceof Error ? err.message : String(err) };
    }
    runs.set(id, { ...outcome, modified });
    if (requestId.current === id) {
      setRunning(current => current === controller ? undefined : current);
      redraw(count => count + 1);
    }
    onResult?.();
  };

  return (
    <section aria-label={t('Security tests')} className="margin-top">
      <hr />
      <h3 className="txt-md margin-top-sm">{t('Tests')}</h3>
      <p className="txt-sm faint">
        {safe
          ? t("Sends this request again, changed a little each time, to see what the API does: without its credentials, with a token it shouldn't accept, as another user, with less privilege, from another site, over plain http, with a quote in a parameter, and many times in a row. Nothing they send is kept.")
          : t('Only a GET or HEAD request is tested: a {method} would change things once more for every test.', { method: request.method })}
      </p>
      {safe && restricted ? (
        <p className="txt-sm notice warning" data-testid="security-restricted-note">
          <i className="fa fa-lock" aria-hidden />
          {' '}
          {lowerEnvironmentId
            ? t('This request is marked as restricted to some users: it will be tried with less privilege.')
            : environments.length
              ? t('This request is marked as restricted to some users. Choose an environment under With less privilege whose user should not be able to make it.')
              : t('This request is marked as restricted to some users. Add an environment whose user should not be able to make it, to try it with less privilege.')}
        </p>
      ) : null}
      {safe ? (
        <div className="flex items-center flex-wrap gap-x-4 gap-y-2 margin-top-sm">
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
          {environments.length ? (
            <label className="flex items-center gap-2 txt-sm" title={t('For a request only some users may make: an environment whose user may not')}>
              {t('With less privilege:')}
              <select
                className="input-box"
                disabled={Boolean(running)}
                value={lowerEnvironmentId}
                onChange={event => setLowerEnvironmentId(event.currentTarget.value)}
              >
                <option value="">{t('Not tested')}</option>
                {environments.map(({ _id, name }) => <option key={_id} value={_id}>{name}</option>)}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-2 txt-sm" title={t('How many times in a row the request is sent, looking for a rate limit. A limit above this number would not show; 0 leaves the test out.')}>
            {t('Rate limit burst:')}
            <input
              type="number"
              className="input-box w-24 m-0 px-2 py-1"
              min={0}
              max={RATE_LIMIT_MOST}
              disabled={Boolean(running)}
              value={rateLimitRequests}
              onChange={event => setRateLimitRequests(rateLimitBurst(event.currentTarget.value === '' ? 0 : Number(event.currentTarget.value)))}
            />
          </label>
        </div>
      ) : null}
      {!running && last?.error ? <p className="danger txt-sm margin-top-sm">{t('The tests could not run: {error}', { error: last.error })}</p> : null}
      {!running && last?.result ? (
        <div className="margin-top-sm">
          {findings.length ? <SecurityFindingList findings={findings} label={t('Security test findings')} onIgnore={onIgnore} /> : null}
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
