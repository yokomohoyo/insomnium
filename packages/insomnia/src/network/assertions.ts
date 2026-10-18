import { JSONPath } from 'jsonpath-plus';

// Checks on a response without scripting: a request's assertions are rendered
// with it (so values can use variables) and checked after each send. There is
// no regex operator: assertions come with imported and synced collections, and
// a crafted pattern could hang the app.

export const ASSERTION_SOURCES = {
  status: 'Status code',
  header: 'Header',
  body: 'Body',
  jsonpath: 'JSON path',
  responseTime: 'Response time (ms)',
} as const;

export const ASSERTION_OPERATORS = {
  equals: 'equals',
  notEquals: 'does not equal',
  contains: 'contains',
  notContains: 'does not contain',
  greaterThan: 'is greater than',
  lessThan: 'is less than',
  exists: 'exists',
  notExists: 'does not exist',
} as const;

export type AssertionSource = keyof typeof ASSERTION_SOURCES;
export type AssertionOperator = keyof typeof ASSERTION_OPERATORS;

export interface RequestAssertion {
  id: string;
  disabled?: boolean;
  source: AssertionSource;
  // the header name, or the JSON path
  property?: string;
  operator: AssertionOperator;
  value?: string;
}

export interface AssertionResult {
  id: string;
  passed: boolean;
  message: string;
  actual?: string;
}

export interface ResponseUnderTest {
  statusCode?: number;
  headers?: { name: string; value: string }[];
  elapsedTime?: number;
  body: string;
}

export const sourceHasProperty = (source: AssertionSource) => source === 'header' || source === 'jsonpath';
export const operatorHasValue = (operator: AssertionOperator) => operator !== 'exists' && operator !== 'notExists';

const asText = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);

const actualValue = ({ source, property = '' }: RequestAssertion, response: ResponseUnderTest): string | undefined => {
  switch (source) {
    case 'status':
      return response.statusCode === undefined ? undefined : String(response.statusCode);
    case 'header':
      if (!property.trim()) {
        throw new Error('give the header name');
      }
      return response.headers?.find(({ name }) => name.toLowerCase() === property.trim().toLowerCase())?.value;
    case 'body':
      return response.body;
    case 'jsonpath': {
      if (!property.trim()) {
        throw new Error('give the JSON path, for example $.data.id');
      }
      let json: unknown;
      try {
        json = JSON.parse(response.body);
      } catch {
        throw new Error('the body is not JSON');
      }
      const found: unknown[] = JSONPath({ path: property.trim(), json: json as object, wrap: true });
      return found.length === 0 ? undefined : asText(found.length === 1 ? found[0] : found);
    }
    case 'responseTime':
      return response.elapsedTime === undefined ? undefined : String(Math.round(response.elapsedTime));
    default:
      throw new Error(`unknown source ${source}`);
  }
};

const isNumber = (text: string) => text.trim() !== '' && Number.isFinite(Number(text));

const passes = (operator: AssertionOperator, actual: string | undefined, expected: string) => {
  const equal = actual !== undefined && (actual === expected || (isNumber(actual) && isNumber(expected) && Number(actual) === Number(expected)));
  switch (operator) {
    case 'equals':
      return equal;
    case 'notEquals':
      return !equal;
    case 'contains':
      return actual !== undefined && actual.includes(expected);
    case 'notContains':
      return actual === undefined || !actual.includes(expected);
    case 'greaterThan':
      return actual !== undefined && isNumber(actual) && isNumber(expected) && Number(actual) > Number(expected);
    case 'lessThan':
      return actual !== undefined && isNumber(actual) && isNumber(expected) && Number(actual) < Number(expected);
    case 'exists':
      return actual !== undefined;
    case 'notExists':
      return actual === undefined;
    default:
      return false;
  }
};

export const describeAssertion = ({ source, property, operator, value = '' }: RequestAssertion) =>
  [ASSERTION_SOURCES[source] || source, sourceHasProperty(source) ? property : '', ASSERTION_OPERATORS[operator] || operator, operatorHasValue(operator) ? value : '']
    .filter(Boolean)
    .join(' ');

const shorten = (text: string) => text.length > 200 ? `${text.slice(0, 200)}…` : text;

export function evaluateAssertions(assertions: RequestAssertion[] | undefined, response: ResponseUnderTest): AssertionResult[] {
  return (assertions || []).filter(assertion => !assertion.disabled).map(assertion => {
    const description = describeAssertion(assertion);
    let actual: string | undefined;
    try {
      actual = actualValue(assertion, response);
    } catch (err) {
      return { id: assertion.id, passed: false, message: `${description}: ${(err as Error).message}` };
    }
    const passed = passes(assertion.operator, actual, assertion.value || '');
    return {
      id: assertion.id,
      passed,
      actual: actual === undefined ? undefined : shorten(actual),
      message: passed ? description : `${description}: got ${actual === undefined ? 'nothing' : JSON.stringify(shorten(actual))}`,
    };
  });
}
