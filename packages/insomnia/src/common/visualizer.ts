// A response's visualization: what an after-response script set with
// insomnia.visualizer.set(template, data) (pm.visualizer.set, as in Postman),
// shown in the response pane's Visualize tab. The template is Handlebars,
// rendered with the data inside the visualizer's own webview, which has no
// network and can't navigate (main/web-hardening.ts), so a template can't send
// the response anywhere. pm.getData(callback) in its scripts gets the data.
export interface Visualization {
  template: string;
  data: unknown;
}

// the webviews' partition, which web-hardening.ts locks down
export const VISUALIZER_PARTITION = 'response-visualizer';

// what a script may set, template and data together, as JSON: the page goes
// to the webview as a data: URL, which Chromium caps at 2 MB
export const MAX_VISUALIZATION_LENGTH = 1024 * 1024;

// JSON safe to put in a <script>: no </script> or <!-- can end it early
const scriptJson = (value: unknown) =>
  JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

// The page the webview shows: the Handlebars runtime, then the template
// rendered with the data, written in as the document. Its own policy allows
// inline scripts and styles, and images from data: and blob: only.
export function visualizationDocument({ template, data }: Visualization, handlebarsRuntime: string) {
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">`,
    `<script>${handlebarsRuntime.replace(/<\/script/gi, '<\\/script')}</script>`,
    '<script>',
    `(function () {
      var data = ${scriptJson(data)};
      var template = ${scriptJson(template)};
      window.pm = { getData: function (callback) { callback(null, data); } };
      var html;
      try {
        html = Handlebars.compile(template)(data);
      } catch (err) {
        html = '<pre style="color: #c00; white-space: pre-wrap">The visualizer template failed: ' + String(err && err.message || err).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }) + '</pre>';
      }
      // once this page is parsed, so the rendered one replaces it (and its scripts run)
      document.addEventListener('DOMContentLoaded', function () {
        document.open();
        document.write(html);
        document.close();
      });
    })();`,
    '</script>',
    '</head><body></body></html>',
  ].join('\n');
}
