// Writes the benchmarks' large inputs to a folder, to try them in the app:
// import the collections (Import > File), set the specs as a document's spec,
// and serve the bodies (e.g. `npx http-server <dir>`) to send requests to.
//
//   npm run perf:fixtures -- <dir>
import fs from 'fs';
import path from 'path';

import { largeCollection, largeEventStream, largeJson, largeOpenApi } from '../src/__perf__/fixtures';

const dir = path.resolve(process.argv[2] || 'perf-fixtures');
fs.mkdirSync(dir, { recursive: true });

const files: Record<string, () => string> = {
  'collection-1k.json': () => JSON.stringify(largeCollection({ folders: 10, requestsPerFolder: 100 })),
  'collection-10k.json': () => JSON.stringify(largeCollection({ folders: 100, requestsPerFolder: 100, envVars: 500 })),
  'collection-nested-5k.json': () => JSON.stringify(largeCollection({ folders: 5, depth: 3, requestsPerFolder: 33 })),
  'response-1mb.json': () => largeJson(1024 * 1024),
  'response-4mb.json': () => largeJson(4 * 1024 * 1024),
  'response-20mb.json': () => largeJson(20 * 1024 * 1024),
  'events-10k.txt': () => largeEventStream(10_000),
  'openapi-2000.json': () => largeOpenApi(2000),
  'openapi-500.yaml': () => largeOpenApi(500, 'yaml'),
};
for (const [name, make] of Object.entries(files)) {
  const contents = make();
  fs.writeFileSync(path.join(dir, name), contents);
  console.log(`${name}: ${(Buffer.byteLength(contents) / 1024 / 1024).toFixed(1)} MB`);
}
