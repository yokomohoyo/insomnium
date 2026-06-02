// Accepts npm package specs the user is allowed to install:
//   - "name"
//   - "@scope/name"
//   - either of the above with an optional "@<version-range>" suffix
// Name segments must start with a lowercase alphanumeric and contain only
// [a-z0-9._-] (npm's documented rules, minus the legacy uppercase grace).
// Rejecting on this boundary blocks shell metacharacters (`;`, `&&`, `$()`,
// backticks, pipes, redirects, spaces) AND path-traversal (`..`, `/`) from
// reaching the yarn argv or the tmpDir path-join in install-plugin.ts.
export const PACKAGE_SPEC_RE =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[A-Za-z0-9._+~^><=*\-|\s]{1,100})?$/;

export function isValidPackageSpec(spec: string): boolean {
  return typeof spec === 'string'
    && spec.length > 0
    && spec.length <= 250
    && PACKAGE_SPEC_RE.test(spec);
}

export function assertValidPackageSpec(spec: string): void {
  if (!isValidPackageSpec(spec)) {
    throw new Error(`Invalid plugin package name: ${JSON.stringify(spec)}`);
  }
}
