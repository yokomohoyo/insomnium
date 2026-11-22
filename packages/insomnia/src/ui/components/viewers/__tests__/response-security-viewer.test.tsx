import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react';
import React from 'react';

import type { AuditFinding } from '../../../../common/response-audit';
import { notInSpecFinding } from '../../../../common/spec-inventory';
import { IgnoredSecurityRules, ResponseSecurityViewer, SpecSecurityNote } from '../response-security-viewer';

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

  it("lets a rule be ignored, by the finding's id", () => {
    const onIgnore = jest.fn();
    const { getByRole } = render(<ResponseSecurityViewer findings={[finding({ id: 'nosniff-missing', title: 'No X-Content-Type-Options: nosniff' })]} onIgnore={onIgnore} />);

    fireEvent.click(getByRole('button', { name: 'Ignore No X-Content-Type-Options: nosniff' }));

    expect(onIgnore).toHaveBeenCalledWith('nosniff-missing');
  });

  it('shows nothing until the response has been looked at', () => {
    expect(render(<ResponseSecurityViewer />).container.textContent).toBe('');
  });
});

describe('<SpecSecurityNote />', () => {
  it('names the operation that describes the request', () => {
    const { getByTestId, queryByRole } = render(<SpecSecurityNote described={['GET /orders/{id}']} />);

    expect(getByTestId('security-spec-described').textContent).toContain('The spec describes this request: GET /orders/{id}');
    expect(queryByRole('list', { name: 'Spec findings' })).toBeNull();
  });

  it("shows a finding for a request the spec doesn't describe, which can be ignored", () => {
    const onIgnore = jest.fn();
    const { getByRole } = render(<SpecSecurityNote described={[]} finding={notInSpecFinding('GET /internal/users')} onIgnore={onIgnore} />);

    expect(getByRole('list', { name: 'Spec findings' }).textContent).toContain("A request the spec doesn't describe");
    expect(getByRole('list', { name: 'Spec findings' }).textContent).toContain('GET /internal/users');
    fireEvent.click(getByRole('button', { name: "Ignore A request the spec doesn't describe" }));
    expect(onIgnore).toHaveBeenCalledWith('not-in-spec');
  });

  it('says so when the collection ignores that rule', () => {
    const { getByTestId } = render(<SpecSecurityNote described={[]} />);

    expect(getByTestId('security-spec-ignored').textContent).toContain('the collection ignores that');
  });
});

describe('<IgnoredSecurityRules />', () => {
  it('names the rules a collection ignores, each with a way back', () => {
    const onRestore = jest.fn();
    const { getByLabelText, getByRole } = render(<IgnoredSecurityRules ignored={['nosniff-missing', 'rate-limit']} onRestore={onRestore} />);

    expect(getByLabelText('Ignored security rules').textContent).toContain('No X-Content-Type-Options: nosniff');
    fireEvent.click(getByRole('button', { name: 'Show No sign of a rate limit again' }));

    expect(onRestore).toHaveBeenCalledWith('rate-limit');
  });

  it('is nothing when nothing is ignored', () => {
    expect(render(<IgnoredSecurityRules ignored={[]} onRestore={jest.fn()} />).container.textContent).toBe('');
  });
});
