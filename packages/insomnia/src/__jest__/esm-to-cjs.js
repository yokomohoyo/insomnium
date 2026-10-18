// Jest 28 runs CommonJS only, and some dependencies now ship only ES modules
// (faker from 10). This turns such a file into CommonJS for the tests; the app's
// bundles take the ES modules as they are.
const { transformSync } = require('esbuild');

module.exports = {
  process(source, filename) {
    const { code, map } = transformSync(source, { format: 'cjs', loader: 'js', target: 'node20', sourcefile: filename, sourcemap: true });
    return { code, map };
  },
};
