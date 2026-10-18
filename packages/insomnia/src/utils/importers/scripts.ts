// Insomnium runs a request's own pre-request and after-response scripts
// (scripting/request-scripts.ts). Postman and Insomnia also run the scripts of
// the collection and folders above a request, first, so on import those are
// copied into each request's, in that order. Each runs in a function of its
// own, so their names and returns stay apart as they were.

export interface InheritedScript {
  // where it came from, e.g. 'Postman folder "Users"'
  from: string;
  code: string;
}

export const withInheritedScripts = (inherited: InheritedScript[], own = '') => {
  const parts = inherited.filter(({ code }) => code.trim());
  if (!parts.length) {
    return own;
  }
  return [...parts, ...(own.trim() ? [{ from: 'this request', code: own }] : [])]
    .map(({ from, code }) => `// from ${from}\nawait (async () => {\n${code.trim()}\n})();`)
    .join('\n\n');
};

// A script as a fenced block of text, for a description
export const scriptAsText = (title: string, note: string, code: string) => {
  const fence = '`'.repeat(Math.max(3, ...(code.match(/`+/g) || []).map(run => run.length + 1)));
  return `**${title}**, ${note}:\n\n${fence}js\n${code}\n${fence}`;
};
