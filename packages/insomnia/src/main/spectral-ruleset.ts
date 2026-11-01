import YAML from 'yaml';

const BUILTIN_RULESETS = new Set(['spectral:oas', 'spectral:asyncapi', 'spectral:arazzo']);

// Rulesets come from synced git repos, so they're untrusted. Spectral's bundler
// runs whatever JS a ruleset pulls in (custom functions, npm/file/URL extends)
// with Node's require in the main process, so only accept rulesets that are
// plain data on top of the built-in ones.
export function assertDataOnlyRuleset(source: string) {
  const ruleset = YAML.parse(source);
  if (!ruleset || typeof ruleset !== 'object' || Array.isArray(ruleset)) {
    throw new Error('ruleset is not an object');
  }
  // Spectral reads the file again with merge keys on, where this parse has
  // them off: keys merged in with << would get past the checks below
  assertNoMergeKeys(ruleset);
  assertDataOnlyDefinition(ruleset);
  for (const override of Array.isArray(ruleset.overrides) ? ruleset.overrides : []) {
    if (override && typeof override === 'object') {
      assertDataOnlyDefinition(override);
    }
  }
}

function assertNoMergeKeys(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(assertNoMergeKeys);
  } else if (value && typeof value === 'object') {
    if ('<<' in value) {
      throw new Error('rulesets with merge keys (<<) are not supported');
    }
    Object.values(value).forEach(assertNoMergeKeys);
  }
}

function assertDataOnlyDefinition(definition: Record<string, unknown>) {
  if ('functions' in definition || 'functionsDir' in definition) {
    throw new Error('rulesets with custom functions are not supported');
  }
  if (definition.extends === undefined) {
    return;
  }
  const entries = Array.isArray(definition.extends) ? definition.extends : [definition.extends];
  for (const entry of entries) {
    const name = Array.isArray(entry) ? entry[0] : entry;
    if (typeof name !== 'string' || !BUILTIN_RULESETS.has(name)) {
      throw new Error(`ruleset can only extend built-in rulesets, not ${JSON.stringify(name)}`);
    }
  }
}
