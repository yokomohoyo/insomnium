import type { ISpectralDiagnostic, RulesetDefinition } from '@stoplight/spectral-core';
import { Spectral } from '@stoplight/spectral-core';
import owaspRuleset from '@stoplight/spectral-owasp-ruleset';
import { bundleAndLoadRuleset } from '@stoplight/spectral-ruleset-bundler/with-loader';
import { asyncapi, oas } from '@stoplight/spectral-rulesets';
import fs from 'fs';
import path from 'path';

import { parseApiSpec } from '../common/api-specs';
import { assertDataOnlyRuleset } from './spectral-ruleset';

const isAsyncApi = (contents: string) => {
  try {
    return parseApiSpec(contents).format === 'asyncapi';
  } catch {
    return false;
  }
};

// the built-in rules for the document: AsyncAPI's or OpenAPI's
const builtInRuleset = (contents: string) => (isAsyncApi(contents) ? asyncapi : oas) as RulesetDefinition;

// The OWASP API Security Top 10 rules (their codes start owasp:), which are for
// OpenAPI documents. They run apart from the document's ruleset, so they're the
// same whatever it is, and a ruleset file stays plain data.
const runOwasp = async (contents: string) => {
  if (isAsyncApi(contents)) {
    return [];
  }
  const spectral = new Spectral();
  spectral.setRuleset(owaspRuleset as RulesetDefinition);
  return spectral.run(contents);
};

const byPosition = (a: ISpectralDiagnostic, b: ISpectralDiagnostic) =>
  a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character;

// A spec's lint results, with the ruleset at rulesetPath (a file chosen for the
// document, or its git repository's .spectral.yaml) or the built-in OpenAPI or
// AsyncAPI rules. A ruleset that can't be used is said first, as a warning, rather than
// quietly linting with the built-in rules instead. With owasp, the OWASP API
// Security rules' findings are among them too. This runs on the Spectral
// worker thread (spectral-worker.ts): the app calls lintSpec in spectral-lint.ts.
export async function runSpectral({ contents, rulesetPath, owasp }: { contents: string; rulesetPath?: string; owasp?: boolean }): Promise<ISpectralDiagnostic[]> {
  const spectral = new Spectral();
  let rulesetProblem = '';

  if (rulesetPath) {
    try {
      assertDataOnlyRuleset(await fs.promises.readFile(rulesetPath, 'utf8'));
      const ruleset = await bundleAndLoadRuleset(rulesetPath, {
        fs,
        fetch: (url: string) => Promise.reject(new Error(`remote rulesets are not supported: ${url}`)),
      });
      spectral.setRuleset(ruleset);
    } catch (err) {
      rulesetProblem = err instanceof Error ? err.message : String(err);
      spectral.setRuleset(builtInRuleset(contents));
    }
  } else {
    spectral.setRuleset(builtInRuleset(contents));
  }

  let diagnostics = await spectral.run(contents);
  if (owasp) {
    diagnostics = [...diagnostics, ...await runOwasp(contents)].sort(byPosition);
  }
  if (!rulesetProblem) {
    return diagnostics;
  }
  const start = { line: 0, character: 0 };
  const warning = {
    code: 'ruleset',
    message: `${path.basename(rulesetPath || '')} couldn't be used, so the built-in rules apply: ${rulesetProblem}`,
    path: [],
    severity: 1,
    range: { start, end: start },
  } as unknown as ISpectralDiagnostic;
  return [warning, ...diagnostics];
}
