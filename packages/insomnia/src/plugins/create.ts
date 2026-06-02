import electron from 'electron';
import fs from 'fs';
import path from 'path';

export async function createPlugin(
  moduleName: string,
  version: string,
  mainJs: string,
) {
  const pluginsRoot = path.join(process.env['INSOMNIA_DATA_PATH'] || (process.type === 'renderer' ? window : electron).app.getPath('userData'), 'plugins');
  const pluginDir = path.join(pluginsRoot, moduleName);

  // Defense in depth: callers are expected to validate moduleName, but assert
  // here that no `..` / absolute path / drive letter escape the plugins root.
  const rel = path.relative(pluginsRoot, pluginDir);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) {
    throw new Error(`Invalid plugin moduleName, escapes plugins root: ${JSON.stringify(moduleName)}`);
  }

  if (fs.existsSync(pluginDir)) {
    throw new Error(`Plugin already exists at "${pluginDir}"`);
  }
  fs.mkdirSync(pluginDir, { recursive: true });

  // Write package.json
  fs.writeFileSync(
    path.join(pluginDir, 'package.json'),
    JSON.stringify(
      {
        name: moduleName,
        version,
        private: true,
        insomnia: {
          name: moduleName.replace(/^insomnia-plugin-/, ''),
          description: '',
        },
        main: 'main.js',
      },
      null,
      2,
    ),
  );
  // Write main JS file
  fs.writeFileSync(path.join(pluginDir, 'main.js'), mainJs);
}
