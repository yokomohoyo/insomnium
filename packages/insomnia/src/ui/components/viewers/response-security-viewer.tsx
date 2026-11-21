import React, { type FC, useEffect, useState } from 'react';

import { t } from '../../../common/i18n';
import { type AuditFinding, type AuditSeverity, auditStoredResponse } from '../../../common/response-audit';
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

export const ResponseSecurityViewer: FC<{ findings?: AuditFinding[] }> = ({ findings }) => {
  if (!findings) {
    return null;
  }
  return (
    <>
      {findings.length ? (
        <ul aria-label={t('Security findings')} className="list-none m-0 p-0">
          {findings.map(finding => (
            <li key={`${finding.id} ${finding.evidence || ''}`} className="flex items-start gap-2 py-2" data-testid={`security-finding-${finding.id}`}>
              <i className={`fa ${SEVERITY_ICONS[finding.severity]} ${SEVERITY_CLASSES[finding.severity]}`} aria-hidden />
              <div className="selectable">
                <div>
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
      ) : (
        <p className="faint">{t('Nothing found in this response.')}</p>
      )}
      <p className="faint txt-sm margin-top">
        {t("These come from this one request and response: its URL, headers, cookies and body. Nothing more is sent to find them, so they can't show what takes trying the API, such as whether one user can read another's data.")}
      </p>
    </>
  );
};
