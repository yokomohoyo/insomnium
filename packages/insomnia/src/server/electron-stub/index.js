// This file implements just enough of the electron module to get sending requests to work
module.exports = {
  app: {
    getPath: (/** @type {string} */ name) => name === 'temp' ? require('os').tmpdir() : require('path').join(require('os').tmpdir(), 'insomnia-send-request'),
    // no app lifecycle without electron; listeners never fire
    on: () => {},
  },
  ipcMain: {
    on: () => {
      // Don't need this yet
    },
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
};
