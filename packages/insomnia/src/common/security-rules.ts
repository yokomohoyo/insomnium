// The rules behind the Security tab's findings, by the id each finding has:
// what a response shows (response-audit.ts) and what the tests find
// (security-tests.ts). A collection can ignore a rule, by its id, kept with
// the collection (Workspace.securityIgnoredRules): exported and synced with it,
// so a team ignores the same rules.
import type { AuditFinding } from './response-audit';

export const SECURITY_RULES: Record<string, string> = {
  // what a response shows
  'plain-http': 'Sent over plain HTTP',
  'hsts-missing': 'No Strict-Transport-Security header',
  'weak-tls': 'An old version of TLS',
  'secret-in-url': 'A credential in the URL',
  'jwt-unsigned': 'An unsigned JSON Web Token',
  'jwt-no-expiry': "A JSON Web Token that doesn't expire",
  'nosniff-missing': 'No X-Content-Type-Options: nosniff',
  'cors-wildcard-credentials': 'CORS allows any origin, with credentials',
  'cors-null-origin': 'CORS allows the null origin',
  'version-disclosure': 'The server says what it runs',
  'cacheable-authenticated': 'An authenticated response that may be cached',
  'html-headers-missing': 'An HTML page without its security headers',
  'cookie-flags': 'A cookie without its flags',
  'error-details': 'The response shows a stack trace or a database error',
  'sensitive-fields': 'The response has fields that look sensitive',
  // what the tests find
  'no-credentials': 'It answers the same without credentials',
  'token-signature': 'It accepts a token whose signature is wrong',
  'token-unsigned': 'It accepts an unsigned token',
  'other-user': 'Another user gets the same answer',
  'lower-privilege': 'A user with less privilege can make this request',
  'cors-any-origin': 'CORS trusts whichever site asks, with credentials',
  'answers-plain-http': 'It also answers over plain http',
  'quote-in-parameter': 'A quote in a parameter breaks the server',
  'rate-limit': 'No sign of a rate limit',
};

// a rule's name, for the list of those ignored
export const securityRuleName = (id: string) => SECURITY_RULES[id] || id;

// the ids that are rules, once each: what's kept is only ever those
export const ignoredRules = (ids: unknown): string[] =>
  Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === 'string' && id in SECURITY_RULES))] : [];

export const withoutIgnored = <T extends Pick<AuditFinding, 'id'>>(findings: T[], ignored: string[]) =>
  ignored.length ? findings.filter(({ id }) => !ignored.includes(id)) : findings;
