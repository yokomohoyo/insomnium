import handlebarsRuntime from 'handlebars/dist/handlebars.min.js?raw';
import React, { FC, useEffect, useRef } from 'react';

import { type Visualization, VISUALIZER_PARTITION, visualizationDocument } from '../../../common/visualizer';

// What the after-response script set with visualizer.set, rendered in a
// webview of its own: no Node, no network, no navigation (main/web-hardening.ts)
export const ResponseVisualizer: FC<{ visualization: Visualization }> = ({ visualization }) => {
  const webviewRef = useRef<Electron.WebviewTag>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    const page = `data:text/html;charset=utf-8;base64,${Buffer.from(visualizationDocument(visualization, handlebarsRuntime), 'utf8').toString('base64')}`;
    const load = () => {
      webview?.removeEventListener('dom-ready', load);
      webview?.loadURL(page);
    };
    webview?.addEventListener('dom-ready', load);
    return () => {
      webview?.removeEventListener('dom-ready', load);
    };
  }, [visualization]);

  return (
    <webview
      data-testid="ResponseVisualizer"
      ref={webviewRef}
      src="about:blank"
      className="w-full h-full"
      // eslint-disable-next-line react/no-unknown-property
      partition={VISUALIZER_PARTITION}
      // eslint-disable-next-line react/no-unknown-property
      webpreferences="disableDialogs=true, javascript=yes"
    />
  );
};
