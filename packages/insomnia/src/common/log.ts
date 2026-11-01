import log from 'electron-log';
import { dirname } from 'path';

import { isDevelopment } from './constants';

export const initializeLogging = () => {
  if (isDevelopment()) {
    // Disable file logging during development
    log.transports.file.level = false;
  } else {
    const fileTransport = log.transports.file;
    // Set the max log file size to 10mb
    // When the log file exceeds this limit, it will be rotated to {file name}.old.log file.
    fileTransport.maxSize = 1024 * 1024 * 10;
    if (process.type === 'renderer') {
      // A window's lines are written when it's idle, not as each is logged:
      // writing one held up the window, a few times for each keystroke. And
      // opening a window doesn't start the file afresh, which emptied what the
      // app had logged since it started.
      fileTransport.sync = false;
    } else {
      // Rotate the log file every time we start the app
      const logFile = fileTransport.getFile();
      fileTransport.archiveLog(logFile);
      logFile.clear();
    }
  }

  // Overwrite the console.log/warn/etc methods
  Object.assign(console, log.functions);
};

export function getLogDirectory() {
  const logPath = log.transports.file.getFile().path;
  return dirname(logPath);
}

export default log;
