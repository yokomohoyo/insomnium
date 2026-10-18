// an MCP request's command arguments, one per line, as they're kept
export const argsOf = (text: string) => text.split('\n').map(arg => arg.trim()).filter(Boolean);

// arguments to start from, for a tool's input schema: each property with an
// empty value of its type, the required ones first
export function argumentsSkeleton(schema?: { properties?: Record<string, { type?: string | string[] }>; required?: string[] }) {
  const properties = Object.entries(schema?.properties || {});
  const required = new Set(schema?.required || []);
  const empty = (type?: string | string[]) => {
    switch (Array.isArray(type) ? type[0] : type) {
      case 'number':
      case 'integer':
        return 0;
      case 'boolean':
        return false;
      case 'array':
        return [];
      case 'object':
        return {};
      default:
        return '';
    }
  };
  const sorted = [...properties.filter(([name]) => required.has(name)), ...properties.filter(([name]) => !required.has(name))];
  return JSON.stringify(Object.fromEntries(sorted.map(([name, property]) => [name, empty(property?.type)])), null, 2);
}
