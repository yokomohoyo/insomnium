import esbuild from 'esbuild';
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
  return Promise.all([main, preload, protoWorker]);
}

// Build if ran as a cli script
const isMain = require.main === module;

if (isMain) {
  const mode =
    process.env.NODE_ENV === 'development' ? 'development' : 'production';
  build({ mode });
}
