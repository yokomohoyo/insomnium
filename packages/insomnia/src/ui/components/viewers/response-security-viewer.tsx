import React, { type FC, useEffect, useState } from 'react';

import { t } from '../../../common/i18n';
import { type AuditFinding, type AuditSeverity, auditStoredResponse } from '../../../common/response-audit';
import { securityRuleName } from '../../../common/security-rules';
import type { Response } from '../../../models/response';

const SEVERITY_CLASSES: Record<AuditSeverity, string> = { high: 'danger', medium: 'warning', low: 'info', info: 'faint' };
const SEVERITY_ICONS: Record<AuditSeverity, string> = {
  high: 'fa-circle-exclamation',
  medium: 'fa-triangle-exclamation',
  low: 'fa-circle-info',
  info: 'fa-circle-info',
};
const severityLabel = (severity: AuditSeverity) => ({ high: t('High'), medium: t('Medium'), low: t('Low'), info: t('Info') })[severity];

// What the response says about the API's security (common/response-audit.ts),
// looked for once per response; undefined until it has been
export const useResponseAudit = (response?: Response | null) => {
  const [audit, setAudit] = useState<{ responseId: string; findings: AuditFinding[] }>();
  useEffect(() => {
    if (!response) {
      return;
    }
    let current = true;
    auditStoredResponse(response)
      .catch(err => {
        console.warn('Failed to audit the response', err);
        return [];
      })
      .then(findings => {
        if (current) {
          setAudit({ responseId: response._id, findings });
        }
      });
    return () => {
      current = false;
    };
    // (a response doesn't change once it's kept)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response?._id]);
  return response && audit?.responseId === response._id ? audit.findings : undefined;
};

// onIgnore: stops a rule's findings being shown in this collection
export const SecurityFindingList: FC<{ findings: AuditFinding[]; label: string; onIgnore?: (id: string) => void }> = ({ findings, label, onIgnore }) => (
  <ul aria-label={label} className="list-none m-0 p-0">
    {findings.map(finding => (
      <li key={`${finding.id} ${finding.evidence || ''}`} className="flex items-start gap-2 py-2" data-testid={`security-finding-${finding.id}`}>
        <i className={`fa ${SEVERITY_ICONS[finding.severity]} ${SEVERITY_CLASSES[finding.severity]}`} aria-hidden />
        <div className="selectable flex-1">
          <div>
            {onIgnore ? (
              <button
                className="btn btn--micro btn--outlined float-right"
                title={t("Don't show this in this collection")}
                aria-label={t('Ignore {rule}', { rule: finding.title })}
                onClick={() => onIgnore(finding.id)}
              >
                {t('Ignore')}
              </button>
            ) : null}
            <strong>{finding.title}</strong>
            <span className={`txt-sm margin-left-sm ${SEVERITY_CLASSES[finding.severity]}`}>{severityLabel(finding.severity)}</span>
          </div>
          {finding.evidence ? <code className="txt-sm">{finding.evidence}</code> : null}
          <div className="txt-sm">{finding.detail}</div>
          <div className="txt-sm faint">{finding.owasp}</div>
        </div>
      </li>
    ))}
  </ul>
);

// The rules this collection ignores, each with a way back
export const IgnoredSecurityRules: FC<{ ignored: string[]; onRestore: (id: string) => void }> = ({ ignored, onRestore }) => ignored.length ? (
  <section aria-label={t('Ignored security rules')} className="margin-top txt-sm faint">
    <hr />
    <p className="margin-top-sm">{t('Not shown in this collection:')}</p>
    <ul className="list-none m-0 p-0">
      {ignored.map(id => (
        <li key={id} className="flex items-center gap-2 py-1">
          <span>{securityRuleName(id)}</span>
          <button className="btn btn--micro btn--outlined" aria-label={t('Show {rule} again', { rule: securityRuleName(id) })} onClick={() => onRestore(id)}>
            {t('Show Again')}
          </button>
        </li>
      ))}
    </ul>
  </section>
) : null;

// noResponse: the request failed, so there was nothing to look at
export const ResponseSecurityViewer: FC<{ findings?: AuditFinding[]; noResponse?: boolean; onIgnore?: (id: string) => void }> = ({ findings, noResponse, onIgnore }) => {
  if (noResponse) {
    return <p className="faint">{t('The request got no response to check.')}</p>;
  }
  if (!findings) {
    return null;
  }
  return (
    <>
      {findings.length ? (
        <SecurityFindingList findings={findings} label={t('Security findings')} onIgnore={onIgnore} />
      ) : (
        <p className="faint">{t('Nothing found in this response.')}</p>
      )}
      <p className="faint txt-sm margin-top">
        {t("These come from this one request and response: its URL, headers, cookies and body. Nothing more is sent to find them, so they can't show what takes trying the API, such as whether one user can read another's data.")}
      </p>
    </>
  );
};
