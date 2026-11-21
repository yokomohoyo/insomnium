import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react';
import React from 'react';

import type { AuditFinding } from '../../../../common/response-audit';
import { ResponseSecurityViewer } from '../response-security-viewer';

const finding = (patch: Partial<AuditFinding>): AuditFinding => ({
  id: 'plain-http',
  severity: 'medium',
  owasp: 'API8:2023 Security Misconfiguration',
  title: 'Sent over plain HTTP',
  detail: 'Use https.',
  ...patch,
});

describe('<ResponseSecurityViewer />', () => {
  it('lists each finding with its severity, evidence and OWASP risk', () => {
    const { getByTestId, getByLabelText } = render(<ResponseSecurityViewer
      findings={[
        finding({ id: 'jwt-unsigned', severity: 'high', title: 'An unsigned JSON Web Token', evidence: 'the response body', owasp: 'API2:2023 Broken Authentication' }),
        finding({}),
      ]}
    />);

    expect(getByLabelText('Security findings').children).toHaveLength(2);
    const unsigned = getByTestId('security-finding-jwt-unsigned').textContent;
    expect(unsigned).toContain('An unsigned JSON Web Token');
    expect(unsigned).toContain('High');
    expect(unsigned).toContain('the response body');
    expect(unsigned).toContain('API2:2023 Broken Authentication');
    expect(getByTestId('security-finding-plain-http').textContent).toContain('Medium');
  });

  it('says when nothing was found, and what was looked at', () => {
    const { container, queryByLabelText } = render(<ResponseSecurityViewer findings={[]} />);

    expect(queryByLabelText('Security findings')).toBeNull();
    expect(container.textContent).toContain('Nothing found in this response.');
    expect(container.textContent).toContain('Nothing more is sent to find them');
  });

  it('says when the request got no response, rather than that nothing was found', () => {
    const { container } = render(<ResponseSecurityViewer findings={[]} noResponse />);

    expect(container.textContent).toBe('The request got no response to check.');
  });

  it('shows nothing until the response has been looked at', () => {
    expect(render(<ResponseSecurityViewer />).container.textContent).toBe('');
  });
});
