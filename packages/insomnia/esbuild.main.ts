import crypto from 'crypto';
import esbuild from 'esbuild';
import fs from 'fs';
import { builtinModules } from 'module';
import path from 'path';

import pkg from './package.json';

interface Options {
  mode?: 'development' | 'production';
}

export default async function build(options: Options) {
  const mode = options.mode || 'production';
  const __DEV__ = mode !== 'production';
  const PORT = pkg.dev['dev-server-port'];

  const outdir = __DEV__
    ? path.join(__dirname, 'src')
    : path.join(__dirname, 'build');

  const env: Record<string, string> = __DEV__
    ? {
      'process.env.APP_RENDER_URL': JSON.stringify(
        `http://localhost:${PORT}/index.html`
      ),
      'process.env.NODE_ENV': JSON.stringify('development'),
      'process.env.INSOMNIA_ENV': JSON.stringify('development'),
      'process.env.BUILD_DATE': JSON.stringify(new Date()),
    }
    : {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env.INSOMNIA_ENV': JSON.stringify('production'),
      'process.env.BUILD_DATE': JSON.stringify(new Date()),
    };
  const preload = esbuild.build({
    entryPoints: ['./src/preload.ts'],
    outfile: path.join(outdir, 'preload.js'),
    target: 'esnext',
    bundle: true,
    platform: 'node',
    sourcemap: true,
    format: 'cjs',
    external: ['electron'],
  });
  const external = [
    'electron',
    '@getinsomnia/node-libcurl',
    ...Object.keys(pkg.dependencies),
    ...Object.keys(builtinModules),
  ];
  const main = esbuild.build({
    entryPoints: ['./src/main.development.ts'],
    outfile: path.join(outdir, 'main.min.js'),
    bundle: true,
    platform: 'node',
    sourcemap: true,
    format: 'cjs',
    define: env,
    external,
  });
  // Worker thread the main process parses proto files on, loaded from next to main.min.js
  const protoWorker = esbuild.build({
    entryPoints: ['./src/main/proto-worker.ts'],
    outfile: path.join(outdir, 'proto-worker.min.js'),
    bundle: true,
    platform: 'node',
    sourcemap: true,
    format: 'cjs',
    define: env,
    external,
  });
  // The page plugins without full access run in (main/plugin-sandbox.ts), its
  // script inline and allowed by its hash, and the page's preload
  const pluginHost = esbuild.build({
    entryPoints: ['./src/plugins/sandbox/host-page.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    write: false,
  }).then(({ outputFiles: [script] }) => {
    const code = script.text.replace(/<\/script/gi, '<\\/script');
    const hash = crypto.createHash('sha256').update(code).digest('base64');
    fs.mkdirSync(outdir, { recursive: true });
    fs.writeFileSync(path.join(outdir, 'plugin-host.html'), [
      '<!doctype html>',
      '<html><head><meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}' 'unsafe-eval'">`,
      '<title>Plugin</title></head><body>',
      `<script>${code}</script>`,
      '</body></html>',
      '',
    ].join('\n'));
  });
  const pluginHostPreload = esbuild.build({
    entryPoints: ['./src/plugins/sandbox/host-preload.ts'],
    outfile: path.join(outdir, 'plugin-host-preload.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });
  // Worker thread the main process lints specs on (main/spectral-lint.ts)
  const spectralWorker = esbuild.build({
    entryPoints: ['./src/main/spectral-worker.ts'],
    outfile: path.join(outdir, 'spectral-worker.min.js'),
    bundle: true,
    platform: 'node',
    sourcemap: true,
    format: 'cjs',
    define: env,
    external,
  });
  return Promise.all([main, preload, protoWorker, spectralWorker, pluginHost, pluginHostPreload]);
}

// Build if ran as a cli script
const isMain = require.main === module;

if (isMain) {
  const mode =
    process.env.NODE_ENV === 'development' ? 'development' : 'production';
  build({ mode });
}
