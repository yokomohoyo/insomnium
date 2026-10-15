declare module 'nunjucks/browser/nunjucks' {
  export function configure(options: any);
  export const runtime: import('./templating/harden-nunjucks').NunjucksRuntime;
}
