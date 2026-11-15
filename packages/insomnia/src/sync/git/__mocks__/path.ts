import { jest } from '@jest/globals';
import pathOriginal from 'path';

const path = jest.requireActual('path') as typeof pathOriginal;

const exportObj: Record<string, unknown> = { __mockPath, ...path };

function __mockPath(type: string) {
  const mock: Record<string, unknown> = { ...(type === 'win32' ? path.win32 : path.posix) };

  Object.keys(mock).forEach(k => {
    exportObj[k] = mock[k];
  });
}

// WARNING: changing this to `export default` will break the mock and be incredibly hard to debug. Ask me how I know.
module.exports = exportObj;
