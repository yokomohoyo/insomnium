import React, { FC, useCallback, useEffect, useState } from 'react';
import { useRouteLoaderData } from 'react-router-dom';

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
    return () => { cancelled = true; clearInterval(id); };
  }, [settings.mcpEnabled, settings.mcpPort]);

  // Prefer the actual running port - that's what clients have to connect to.
  const effectivePort = runningPort ?? settings.mcpPort;
  const sseUrl = effectivePort > 0 ? `http://${HOST}:${effectivePort}/sse` : `http://${HOST}:<starting...>/sse`;
  const claudeCmd = token && effectivePort > 0
    ? `claude mcp add --transport sse insomnium ${sseUrl} --header "Authorization: Bearer ${token}"`
    : '(enable the server to get a one-line install command)';

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
        Expose this Insomnium instance as a Model Context Protocol server so MCP-aware tools
        (Claude Code, etc.) can list, inspect, and run your saved requests. Loopback-only;
        Bearer-token gated. Disabled by default.
      </p>

      <BooleanSetting
        label="Enable MCP automation server"
        setting="mcpEnabled"
        help="When on, Insomnium runs an HTTP+SSE server on 127.0.0.1 exposing the Phase 1 tool surface (workspaces, requests, environments, send_http_request)."
      />

      <NumberSetting
        label="Port"
        setting="mcpPort"
        min={0}
        max={65535}
        help="0 = let the OS pick a free port. Set a fixed port to make the connection URL stable across restarts."
      />

      <div className="form-control form-control--outlined margin-top-sm">
        <label>
          Auth token
          <div className="row no-wrap">
            <input
              readOnly
              type="text"
              value={token || '(not yet generated — enable the server)'}
              style={{ fontFamily: 'monospace' }}
            />
            <button
              className="btn btn--clicky space-left"
              disabled={!token}
              onClick={() => copy('token', token)}
            >
              {copied === 'token' ? 'Copied' : 'Copy'}
            </button>
            <button className="btn btn--clicky space-left" onClick={regenerateToken}>
              Regenerate
            </button>
          </div>
        </label>
      </div>

      <div className="form-control form-control--outlined margin-top-sm">
        <label>
          Connection URL
          <div className="row no-wrap">
            <input
              readOnly
              type="text"
              value={sseUrl}
              style={{ fontFamily: 'monospace' }}
            />
            <button
              className="btn btn--clicky space-left"
              disabled={effectivePort <= 0}
              onClick={() => copy('url', sseUrl)}
            >
              {copied === 'url' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </label>
      </div>

      <div className="form-control form-control--outlined margin-top-sm">
        <label>
          Claude Code install command
          <div className="row no-wrap">
            <input
              readOnly
              type="text"
              value={claudeCmd}
              style={{ fontFamily: 'monospace' }}
            />
            <button
              className="btn btn--clicky space-left"
              disabled={!token || effectivePort <= 0}
              onClick={() => copy('cmd', claudeCmd)}
            >
              {copied === 'cmd' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </label>
      </div>
    </div>
  );
};
