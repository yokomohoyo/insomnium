import orderedJSON from 'json-order';

import { JSON_ORDER_PREFIX, JSON_ORDER_SEPARATOR } from '../../../common/constants';
import { splitSecrets } from '../../../common/environment-secrets';
import { NUNJUCKS_TEMPLATE_GLOBAL_PROPERTY_NAME } from '../../../templating';

// NeDB field names cannot begin with '$' or contain a period '.'
// Docs: https://github.com/DeNA/nedb#inserting-documents
const INVALID_NEDB_KEY_REGEX = /^\$|\./;

export const ensureKeyIsValid = (key: string, isRoot: boolean): string | null => {
  if (key.match(INVALID_NEDB_KEY_REGEX)) {
    return `"${key}" cannot begin with '$' or contain a '.'`;
  }

  if (key === NUNJUCKS_TEMPLATE_GLOBAL_PROPERTY_NAME && isRoot) {
    return `"${NUNJUCKS_TEMPLATE_GLOBAL_PROPERTY_NAME}" is a reserved key`;
  }

  return null;
};

/**
 * Recursively check nested keys in and immediately return when an invalid key found
 */
export function checkNestedKeys(obj: Record<string, any>, isRoot = true): string | null {
  for (const key in obj) {
    let result: string | null = null;

    // Check current key
    result = ensureKeyIsValid(key, isRoot);

    // Exit if necessary
    if (result) {
      return result;
    }

    // Check nested keys
    if (typeof obj[key] === 'object') {
      result = checkNestedKeys(obj[key], false);
    }

    // Exit if necessary
    if (result) {
      return result;
    }
  }

  return null;
}

export interface EnvironmentInfo {
  object: Record<string, any>;
  propertyOrder: Record<string, any> | null;
  // the secret variables, and their values, kept apart (common/environment-secrets.ts)
  secretKeys?: string[];
  secrets?: Record<string, string>;
}

// An environment as a table of its top-level variables. A text value is kept
// as a string; a JSON one (a number, true, a list, an object…) keeps its type,
// as the JSON editor does.
export interface VariableRow {
  id: string;
  name: string;
  value: string;
  type: 'text' | 'json';
  // its value is kept on this computer only, encrypted (always text)
  secret?: boolean;
}

let nextRowId = 0;
export const newRowId = () => `row-${++nextRowId}`;

export const rowsFromEnvironment = ({ object, propertyOrder, secretKeys = [], secrets = {} }: EnvironmentInfo): VariableRow[] => {
  const split = splitSecrets(object, secretKeys, secrets);
  const ordered: Record<string, unknown> = propertyOrder ? orderedJSON.order(split.data, propertyOrder, JSON_ORDER_SEPARATOR) : split.data;
  return Object.entries(ordered).map(([name, value]) => ({
    id: newRowId(),
    name,
    ...(split.secretKeys.includes(name)
      ? { value: split.secrets[name], type: 'text' as const, secret: true }
      : typeof value === 'string' ? { value, type: 'text' as const } : { value: JSON.stringify(value), type: 'json' as const }),
  }));
};

// The environment the rows make, in their order, or what's wrong with them
export const environmentFromRows = (rows: VariableRow[]): { info: EnvironmentInfo; error?: undefined } | { info?: undefined; error: string } => {
  const object: Record<string, unknown> = {};
  const secretKeys: string[] = [];
  const secrets: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(object, name)) {
      return { error: `"${name}" is in the table twice` };
    }
    if (row.secret) {
      // the environment keeps its name, with an empty value
      object[name] = '';
      secretKeys.push(name);
      secrets[name] = row.value;
    } else if (row.type === 'json') {
      try {
        object[name] = JSON.parse(row.value);
      } catch {
        return { error: `The value of "${name}" isn't JSON: write it in quotes, or make it Text` };
      }
    } else {
      object[name] = row.value;
    }
  }
  const keyError = checkNestedKeys(object);
  if (keyError) {
    return { error: keyError };
  }
  const { map } = orderedJSON.parse(JSON.stringify(object), JSON_ORDER_PREFIX, JSON_ORDER_SEPARATOR);
  return { info: { object, propertyOrder: map || null, secretKeys, secrets } };
};
