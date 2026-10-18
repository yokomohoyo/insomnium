// Bundles the headless MCP server (src/server) into packages/insomnium-server/dist:
// everything in one file, with libcurl's native binding copied next to it and
// the proto worker the gRPC code loads from beside the bundle.
import { build, BuildOptions } from 'esbuild';
import alias from 'esbuild-plugin-alias';
import path from 'path';

const outdir = path.resolve(__dirname, '../insomnium-server/dist');

const common: BuildOptions = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  outdir,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.INSOMNIA_ENV': JSON.stringify('production'),
  },
  plugins: [
    alias({
      // just enough of electron for the network and model code
      'electron': path.resolve(__dirname, './send-request/electron/index.js'),
    }),
  ],
  loader: { '.node': 'copy' },
  // proto-worker.ts falls back to its own protobufjs when proto-loader is bundled
  logOverride: { 'require-resolve-not-external': 'silent' },
};

async function main() {
  await build({
    ...common,
    entryPoints: { 'index': './src/server/index.ts', 'proto-worker.min': './src/main/proto-worker.ts' },
  });
  process.exit(0);
}

main();
