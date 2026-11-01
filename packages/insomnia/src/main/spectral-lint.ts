import type { ISpectralDiagnostic, RulesetDefinition } from '@stoplight/spectral-core';
import { Spectral } from '@stoplight/spectral-core';
// @ts-expect-error - This is a bundled file not sure why it's not found
import { bundleAndLoadRuleset } from '@stoplight/spectral-ruleset-bundler/with-loader';
import { asyncapi, oas } from '@stoplight/spectral-rulesets';
import fs from 'fs';
import path from 'path';

import { parseApiSpec } from '../common/api-specs';
import { assertDataOnlyRuleset } from './spectral-ruleset';

// the built-in rules for the document: AsyncAPI's or OpenAPI's
const builtInRuleset = (contents: string) => {
  try {
    return (parseApiSpec(contents).format === 'asyncapi' ? asyncapi : oas) as RulesetDefinition;
  } catch {
    return oas as RulesetDefinition;
  }
};

// A spec's lint results, with the ruleset at rulesetPath (a file chosen for the
// document, or its git repository's .spectral.yaml) or the built-in OpenAPI or
// AsyncAPI rules. A ruleset that can't be used is said first, as a warning, rather than
// quietly linting with the built-in rules instead.
export async function lintSpec(options: { contents: string; rulesetPath?: string }): Promise<ISpectralDiagnostic[]> {
  const key = await lintKey(options);
  let result = recentLints.get(key);
  if (!result) {
    result = lint(options);
    result.catch(() => recentLints.delete(key));
    if (recentLints.size >= RECENT_LINTS) {
      recentLints.delete(recentLints.keys().next().value!);
    }
  }
  // the most recent last
  recentLints.delete(key);
  recentLints.set(key, result);
  return result;
}

// The last few results, by the text and the ruleset's: after an edit the Spec
// tab's loader and its editor each lint the same text, and the loader again on
// every revalidation (any request saved), each taking seconds on a large spec
// and holding up the main process meanwhile.
const recentLints = new Map<string, Promise<ISpectralDiagnostic[]>>();
const RECENT_LINTS = 4;

const lintKey = async ({ contents, rulesetPath }: { contents: string; rulesetPath?: string }) => {
  let ruleset = '';
  if (rulesetPath) {
    // (one that can be used extends only built-in rulesets, so it's all in this file)
    ruleset = await fs.promises.readFile(rulesetPath, 'utf8').then(source => `${rulesetPath}\n${source}`, () => `${rulesetPath} unreadable`);
  }
  return `${ruleset}\0${contents}`;
};

async function lint({ contents, rulesetPath }: { contents: string; rulesetPath?: string }): Promise<ISpectralDiagnostic[]> {
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

  const diagnostics = await spectral.run(contents);
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
