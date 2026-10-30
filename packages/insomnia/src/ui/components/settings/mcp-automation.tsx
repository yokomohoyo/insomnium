import React, { FC, useCallback, useEffect, useState } from 'react';
import { useRouteLoaderData } from 'react-router-dom';

import { t } from '../../../common/i18n';
import { useSettingsPatcher } from '../../hooks/use-request';
import { RootLoaderData } from '../../routes/root';
import { BooleanSetting } from './boolean-setting';
import { NumberSetting } from './number-setting';

// Loopback-only host. Reflected in the connection URL shown to the user.
const HOST = '127.0.0.1';

export const McpAutomation: FC = () => {
  const { settings } = useRouteLoaderData('root') as RootLoaderData;
  const patchSettings = useSettingsPatcher();
  const [copied, setCopied] = useState<string | null>(null);
  const [runningPort, setRunningPort] = useState<number | null>(null);

  const token = settings.mcpToken;

  // Poll for live server status - port changes after enable when mcpPort=0.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const s = await window.main.getMcpStatus();
      if (!cancelled) setRunningPort(s.running ? s.port : null);
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
 cancelled = true; clearInterval(id);
};
  }, [settings.mcpEnabled, settings.mcpPort]);

  // Only the running server's port: the configured one isn't listening while
  // it's off, and may not be what it gets (0 lets the OS pick)
  const running = runningPort !== null;
  const sseUrl = `http://${HOST}:${runningPort}/sse`;
  const claudeCmd = `claude mcp add --transport sse insomnium ${sseUrl} --header "Authorization: Bearer ${token}"`;

  const copy = useCallback((label: string, value: string) => {
    navigator.clipboard.writeText(value).catch(() => { });
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const regenerateToken = useCallback(() => {
    // 24 random bytes -> base64url ~32 chars. crypto.getRandomValues is available in renderer.
    const buf = new Uint8Array(24);
    crypto.getRandomValues(buf);
    const tok = btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    patchSettings({ mcpToken: tok });
  }, [patchSettings]);

  return (
    <div>
      <p className="faint italic margin-bottom-sm">
        {t('Expose this Insomnium instance as a Model Context Protocol server so MCP-aware tools (Claude Code, etc.) can list, inspect, and run your saved requests.')}{' '}
        {t('Loopback-only; Bearer-token gated.')} {t('Disabled by default.')}
      </p>

      <BooleanSetting
        label={t('Enable MCP automation server')}
        setting="mcpEnabled"
        help={t('When on, Insomnium runs an HTTP+SSE server on 127.0.0.1 for MCP clients such as coding agents: they can list and send your requests, run collections, and add or change requests, folders and environments.')}
      />

      <NumberSetting
        label={t('Port')}
        setting="mcpPort"
        min={0}
        max={65535}
        help={t('0 = let the OS pick a free port. Set a fixed port to make the connection URL stable across restarts.')}
      />

      <p className={running ? 'notice info' : 'notice warning'}>
        {running
          ? t('Running on port {port}: MCP clients can connect with the URL and token below.', { port: runningPort })
          : t('Not running. The connection URL and the install command show here once the server is on.')}
      </p>

      <div className="form-control form-control--outlined margin-top-sm">
        <label>
          {t('Auth token')}
          <div className="row no-wrap">
            <input
              readOnly
              type="text"
              value={token || t('(not yet generated — enable the server)')}
              disabled={!running}
              style={{ fontFamily: 'monospace' }}
            />
            <button
              className="btn btn--clicky space-left"
              disabled={!token || !running}
              onClick={() => copy('token', token)}
            >
              {copied === 'token' ? t('Copied') : t('Copy')}
            </button>
            <button className="btn btn--clicky space-left" onClick={regenerateToken}>
              {t('Regenerate')}
            </button>
          </div>
        </label>
      </div>

      {running && <div className="form-control form-control--outlined margin-top-sm">
        <label>
          {t('Connection URL')}
          <div className="row no-wrap">
            <input
              readOnly
              type="text"
              value={sseUrl}
              style={{ fontFamily: 'monospace' }}
            />
            <button
              className="btn btn--clicky space-left"
              onClick={() => copy('url', sseUrl)}
            >
              {copied === 'url' ? t('Copied') : t('Copy')}
            </button>
          </div>
        </label>
      </div>}

      {running && <div className="form-control form-control--outlined margin-top-sm">
        <label>
          {t('Claude Code install command')}
          <div className="row no-wrap">
            <input
              readOnly
              type="text"
              value={claudeCmd}
              style={{ fontFamily: 'monospace' }}
            />
            <button
              className="btn btn--clicky space-left"
              disabled={!token}
              onClick={() => copy('cmd', claudeCmd)}
            >
              {copied === 'cmd' ? t('Copied') : t('Copy')}
            </button>
          </div>
        </label>
      </div>}
    </div>
  );
};
