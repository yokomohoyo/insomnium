import YAML from 'yaml';

export interface ParsedApiSpec {
  contents: Record<string, any> | null;
  rawContents: string;
  format: 'openapi' | 'swagger' | 'asyncapi' | null;
  formatVersion: string | null;
}

export function parseApiSpec(
  rawDocument: string,
) {
  const result: ParsedApiSpec = {
    contents: null,
    rawContents: rawDocument,
    format: null,
    formatVersion: null,
  };

  // NOTE: JSON is valid YAML so we only need to parse YAML. But a JSON document
  // is parsed as JSON first: YAML takes 30 times as long (700 ms for 3 MB).
  try {
    result.contents = parseJson(rawDocument) ?? YAML.parse(rawDocument);
  } catch (err) {
    throw new Error('Failed to parse API spec');
  }

  if (result.contents) {
    if (result.contents.openapi) {
      // Check if it's OpenAPI
      result.format = 'openapi';
      result.formatVersion = result.contents.openapi;
    } else if (result.contents.swagger) {
      // Check if it's Swagger
      result.format = 'swagger';
      result.formatVersion = result.contents.swagger;
    } else if (result.contents.asyncapi) {
      // event-driven APIs: linted and previewed, but not made into requests
      result.format = 'asyncapi';
      result.formatVersion = String(result.contents.asyncapi);
    } else {
      // Not sure what format it is
    }
  }

  return result;
}

// a JSON object or array, or undefined for anything else (YAML, broken JSON)
function parseJson(rawDocument: string) {
  if (!/^\s*[{[]/.test(rawDocument)) {
    return undefined;
  }
  try {
    return JSON.parse(rawDocument);
  } catch {
    return undefined;
  }
}
