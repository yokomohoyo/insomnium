import { app, session, type Session, type WebContents } from 'electron';

import { isDevelopment } from '../common/constants';
import { VISUALIZER_PARTITION } from '../common/visualizer';

// The app's own page only needs clipboard writes (copy buttons); everything
// else it does (links, files, dialogs) goes through IPC. Deny every other web
// permission on every session, so response previews and OAuth pages can't open
// external apps, use the camera, and so on.
const isAppPage = (url: string) => url.startsWith('file:') || isDevelopment();
const isAllowed = (permission: string, url: string) =>
  permission === 'clipboard-sanitized-write' && isAppPage(url);

export function lockDownSession(session: Session) {
  session.setPermissionRequestHandler((_, permission, callback, details) =>
    callback(isAllowed(permission, details.requestingUrl)));
  session.setPermissionCheckHandler((_, permission, requestingOrigin) => isAllowed(permission, requestingOrigin));
}

// <webview> guests show untrusted content (response and PDF previews): no
// preload or Node, no popups, and only http(s) navigation.
function lockDownWebview(contents: WebContents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!/^https?:/i.test(url)) {
      event.preventDefault();
    }
  });
}

// The visualizer's webviews render a script's template with the response, so
// nothing in them may leave: no network at all (their page comes as a data:
// URL), and no navigation.
const isLocal = (url: string) => /^(data|blob|devtools|about):/i.test(url);

function lockDownVisualizer(visualizer: Session) {
  visualizer.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isLocal(details.url) }));
}

export function hardenWebContents() {
  app.on('session-created', lockDownSession);
  app.whenReady().then(() => lockDownVisualizer(session.fromPartition(VISUALIZER_PARTITION)));
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-attach-webview', (_event, webPreferences) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
    });
    if (contents.getType() === 'webview') {
      lockDownWebview(contents);
      if (contents.session === session.fromPartition(VISUALIZER_PARTITION)) {
        contents.on('will-navigate', event => event.preventDefault());
        contents.on('will-frame-navigate', event => {
          if (!isLocal(event.url)) {
            event.preventDefault();
          }
        });
      }
    }
  });
}
