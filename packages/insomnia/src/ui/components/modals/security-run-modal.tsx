import fs from 'fs';
import React, { type FC, useCallback, useEffect, useRef, useState } from 'react';
import { OverlayContainer } from 'react-aria';
import { useNavigate, useParams, useRouteLoaderData } from 'react-router-dom';

import { getAppVersion } from '../../../common/constants';
import { t } from '../../../common/i18n';
import type { AuditSeverity } from '../../../common/response-audit';
import { ignoredRules } from '../../../common/security-rules';
import type { SecurityCheckOutcome } from '../../../common/security-tests';
import { listRunnableRequests, type RunnableRequest } from '../../../network/runner';
import { securityJsonReport, securityMarkdownReport, securitySarifReport } from '../../../network/security-report';
import { runSecurityChecks, type SecurityRunItem, securityRunMaxRequests, type SecurityRunSummary } from '../../../network/security-run';
import { requestPath } from '../../routes/paths';
import type { WorkspaceLoaderData } from '../../routes/workspace';
import { Modal, type ModalHandle, type ModalProps } from '../base/modal';
import { ModalBody } from '../base/modal-body';
import { ModalFooter } from '../base/modal-footer';
import { ModalHeader } from '../base/modal-header';
import { SecurityFindingList } from '../viewers/response-security-viewer';

// what a finished run saves as: a page to read, the run as it is, or results
// for a tool that takes code scanning's
const REPORTS = {
  markdown: { button: 'Save Markdown', label: 'Markdown report', extension: 'md', write: (summary: SecurityRunSummary, name: string) => securityMarkdownReport(summary, name) },
  json: { button: 'Save JSON', label: 'JSON report', extension: 'json', write: (summary: SecurityRunSummary, name: string) => securityJsonReport(summary, name) },
  sarif: { button: 'Save SARIF', label: 'SARIF report', extension: 'sarif', write: (summary: SecurityRunSummary, name: string) => securitySarifReport(summary, name, getAppVersion()) },
};

const SEVERITIES: AuditSeverity[] = ['high', 'medium', 'low', 'info'];
const SEVERITY_CLASSES: Record<AuditSeverity, string> = { high: 'danger', medium: 'warning', low: 'info', info: 'faint' };
const severityLabel = (severity: AuditSeverity) => ({ high: t('high'), medium: t('medium'), low: t('low'), info: t('info') })[severity];
const OUTCOME_ICONS: Record<SecurityCheckOutcome, string> = {
  found: 'fa-circle-exclamation warning',
  passed: 'fa-circle-check success',
  skipped: 'fa-circle-minus faint',
  unclear: 'fa-circle-question info',
};
const outcomeLabel = (outcome: SecurityCheckOutcome) => ({ found: t('Found'), passed: t('Passed'), skipped: t('Not run'), unclear: t('Unclear') })[outcome];

interface Props {
  // a folder's id, or the collection's
  parentId: string;
  name: string;
  // the folders above the requests, for their names (a folder's own name)
  folders?: string[];
  // (the run's: replaced in tests)
  run?: typeof runSecurityChecks;
  list?: typeof listRunnableRequests;
}

const ItemRow: FC<{ item: SecurityRunItem; onOpen: (requestId: string) => void }> = ({ item, onOpen }) => {
  const worst = SEVERITIES.find(severity => item.findings.some(finding => finding.severity === severity));
  return (
    <li className="py-2 border-b border-solid border-[--hl-sm]" data-testid={`security-run-item-${item.requestId}`}>
      <details open={item.findings.length > 0}>
        <summary className="cursor-pointer">
          <span className="txt-sm faint">{[...item.folders, ''].join(' / ')}</span>
          <button
            className="btn btn--super-super-compact p-0 font-bold"
            title={t('Open the request')}
            onClick={event => {
 event.preventDefault(); onOpen(item.requestId);
}}
          >
            {item.name || item.url}
          </button>
          <span className="txt-sm faint margin-left-sm">{item.method} {item.url}</span>
          <span className={`txt-sm margin-left-sm ${worst ? SEVERITY_CLASSES[worst] : item.outcome === 'skipped' ? 'faint' : 'success'}`}>
            {item.outcome === 'skipped'
              ? t('not checked')
              : item.findings.length
                ? t('{count, plural, one {# finding} other {# findings}}', { count: item.findings.length })
                : t('nothing found')}
          </span>
        </summary>
        <div className="pad-left">
          {item.note ? <p className="txt-sm faint">{item.note}</p> : null}
          {item.findings.length ? <SecurityFindingList findings={item.findings} label={t('Findings for {name}', { name: item.name })} /> : null}
          {item.checks.length ? (
            <ul aria-label={t('Tests run on {name}', { name: item.name })} className="list-none m-0 p-0">
              {item.checks.map(check => (
                <li key={check.id} className="flex items-start gap-2 py-1 txt-sm">
                  <i className={`fa ${OUTCOME_ICONS[check.outcome]}`} aria-hidden />
                  <div className="selectable">
                    <strong>{check.title}</strong>
                    <span className="faint margin-left-sm">{outcomeLabel(check.outcome)}</span>
                    <div className="faint">{check.note}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
    </li>
  );
};

// The security checks over a folder or the collection: what the response
// pane's Security tab does for one request, for each of them in turn, with a
// report to keep. The Run button, which says how many requests it may send, is
// the go-ahead.
export const SecurityRunModal: FC<ModalProps & Props> = ({ parentId, name, folders = [], onHide, run = runSecurityChecks, list = listRunnableRequests }) => {
  const modalRef = useRef<ModalHandle>(null);
  const navigate = useNavigate();
  const { organizationId, projectId, workspaceId } = useParams() as { organizationId: string; projectId: string; workspaceId: string };
  const { activeEnvironment, subEnvironments, activeWorkspaceMeta } = useRouteLoaderData(':workspaceId') as WorkspaceLoaderData;
  const [requests, setRequests] = useState<RunnableRequest[]>();
  const [otherEnvironmentId, setOtherEnvironmentId] = useState('');
  const [lowerEnvironmentId, setLowerEnvironmentId] = useState('');
  const [items, setItems] = useState<SecurityRunItem[]>([]);
  const [summary, setSummary] = useState<SecurityRunSummary>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController>();
  // a stable dependency for the effect, though the array is new each render
  const folderKey = JSON.stringify(folders);

  useEffect(() => {
    modalRef.current?.show();
    list(parentId, JSON.parse(folderKey)).then(setRequests);
  }, [parentId, folderKey, list]);

  const maxRequests = securityRunMaxRequests(requests || []);
  const others = subEnvironments.filter(({ _id }) => _id !== activeEnvironment._id);

  const start = async () => {
    controller.current = new AbortController();
    setItems([]);
    setSummary(undefined);
    setError('');
    setRunning(true);
    try {
      setSummary(await run(requests || [], {
        otherEnvironmentId: otherEnvironmentId || null,
        lowerEnvironmentId: lowerEnvironmentId || null,
        ignored: ignoredRules(activeWorkspaceMeta?.securityIgnoredRules),
        signal: controller.current.signal,
        onItem: item => setItems(done => [...done, item]),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setRunning(false);
  };

  const save = async (kind: keyof typeof REPORTS) => {
    if (!summary) {
      return;
    }
    const report = REPORTS[kind];
    const { canceled, filePath } = await window.dialog.showSaveDialog({
      title: `Save ${report.label}`,
      buttonLabel: 'Save',
      defaultPath: `${name.replace(/[\\/:*?"<>|]/g, '-')}-security.${report.extension}`,
    });
    if (canceled || !filePath) {
      return;
    }
    await fs.promises.writeFile(filePath, report.write(summary, name));
  };

  const openRequest = useCallback((requestId: string) => {
    modalRef.current?.hide();
    navigate(requestPath({ organizationId, projectId, workspaceId }, requestId));
  }, [navigate, organizationId, projectId, workspaceId]);

  // closing it stops the run
  const hide = () => {
    controller.current?.abort();
    onHide?.();
  };

  const found = summary ? SEVERITIES.filter(severity => summary.findings[severity]) : [];
  const started = running || items.length > 0;

  return (
    <OverlayContainer onClick={e => e.stopPropagation()}>
      <Modal ref={modalRef} onHide={hide} wide tall>
        <ModalHeader>{t('Security Checks: {name}', { name })}</ModalHeader>
        <ModalBody className="pad">
          {/* what it will do, until it's doing it: the results want the room */}
          {!started && (
            <p className="faint txt-sm no-margin-top" data-testid="security-run-intro">
              {t('Checks each of these requests as its Security tab does, with the {environment} environment. A GET or HEAD is sent again, changed a little each time, and its answer looked at. Any other request is never sent: it gets what its last response showed. Nothing sent is kept.', { environment: activeEnvironment.name })}
              {' '}
              <strong className="warning">{t("Run it only against an API you're allowed to test.")}</strong>
            </p>
          )}
          {requests && !started && (
            <p data-testid="security-run-plan" className="no-margin-top">
              {t('{count, plural, one {# request} other {# requests}}', { count: requests.length })}
              {': '}
              {t('up to {max} requests will be sent.', { max: maxRequests })}
            </p>
          )}
          {others.length && !started ? (
            <label className="flex items-center gap-2 txt-sm">
              {t('As another user:')}
              <select className="input-box" disabled={running} value={otherEnvironmentId} onChange={event => setOtherEnvironmentId(event.currentTarget.value)}>
                <option value="">{t('Not tested')}</option>
                {others.map(({ _id, name: environment }) => <option key={_id} value={_id}>{environment}</option>)}
              </select>
            </label>
          ) : null}
          {others.length && !started ? (
            <label className="flex items-center gap-2 txt-sm margin-top-sm" title={t('For requests only some users may make, such as a folder of admin requests: an environment whose user may not')}>
              {t('With less privilege:')}
              <select className="input-box" disabled={running} value={lowerEnvironmentId} onChange={event => setLowerEnvironmentId(event.currentTarget.value)}>
                <option value="">{t('Not tested')}</option>
                {others.map(({ _id, name: environment }) => <option key={_id} value={_id}>{environment}</option>)}
              </select>
            </label>
          ) : null}
          {error && <p className="notice error">{error}</p>}
          {started && (
            <section>
              <p data-testid="security-run-summary" className={summary ? (summary.findings.high ? 'danger' : summary.findings.medium ? 'warning' : 'success') : 'faint'}>
                {summary
                  ? `${found.length ? found.map(severity => `${summary.findings[severity]} ${severityLabel(severity)}`).join(', ') : t('Nothing found')} · ${t('{count, plural, one {# request sent} other {# requests sent}}', { count: summary.requests })}${summary.stopped ? ` · ${t('stopped')}` : ''}`
                  : t('Checking: {done} of {total}', { done: items.length, total: requests?.length || 0 })}
              </p>
              <ul aria-label={t('Security check results')} className="list-none m-0 p-0">
                {items.map(item => <ItemRow key={item.requestId} item={item} onOpen={openRequest} />)}
              </ul>
              {summary ? (
                <p className="faint txt-sm margin-top-sm">
                  {t('A request with nothing found had none of these problems this once; that does not show the API is secure.')}
                </p>
              ) : null}
            </section>
          )}
        </ModalBody>
        <ModalFooter>
          <div className="margin-left flex gap-2">
            {summary && (Object.keys(REPORTS) as (keyof typeof REPORTS)[]).map(kind => (
              <button key={kind} className="btn btn--compact modal__footer-secondary" onClick={() => save(kind)}>{REPORTS[kind].button}</button>
            ))}
          </div>
          {running
            ? <button className="btn" onClick={() => controller.current?.abort()}>{t('Stop')}</button>
            : (
              <button className="btn" disabled={!requests?.length} onClick={start}>
                {started ? t('Run Again (up to {max} requests)', { max: maxRequests }) : t('Run the Checks (up to {max} requests)', { max: maxRequests })}
              </button>
            )}
        </ModalFooter>
      </Modal>
    </OverlayContainer>
  );
};
