// Git over SSH for the app's windows (see transport.ts): the agents of this
// OS, the app's own list of trusted hosts, and a dialog for one not seen before.
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { env, platform } from 'process';

import { type GitSshRequest, gitSshRequest, type HostToTrust } from './transport';

const WINDOWS_OPENSSH_AGENT = '\\\\.\\pipe\\openssh-ssh-agent';

// the SSH agent: SSH_AUTH_SOCK's, or on Windows OpenSSH's service, then Pageant
export function agentsHere() {
  if (platform === 'win32') {
    return [...(fs.existsSync(WINDOWS_OPENSSH_AGENT) ? [WINDOWS_OPENSSH_AGENT] : []), 'pageant'];
  }
  return env.SSH_AUTH_SOCK ? [env.SSH_AUTH_SOCK] : [];
}

// hosts turned down this session, not asked about again until the app restarts
// (the Git Sync menu fetches every five minutes)
const declined = new Set<string>();

async function askToTrust(window: BrowserWindow | null, host: HostToTrust) {
  const asked = `${host.host} ${host.fingerprint}`;
  if (declined.has(asked)) {
    return false;
  }
  const options = {
    type: 'question' as const,
    buttons: ['Trust and Connect', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Connect over SSH',
    message: `Trust ${host.host}?`,
    detail: [
      `Insomnium hasn't connected to ${host.host} before${host.otherTypesKnown ? ' with this type of key (it knows others for it)' : ''}, and it isn't in your known_hosts.`,
      '',
      `Its ${host.keyType} key's fingerprint is`,
      host.fingerprint,
      '',
      'Check it against the fingerprints the host publishes (GitHub, GitLab and Bitbucket list theirs in their docs) before trusting it.',
    ].join('\n'),
  };
  const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
  if (response !== 0) {
    declined.add(asked);
  }
  return response === 0;
}

export function registerGitSshHandlers() {
  ipcMain.handle('gitSshRequest', (event, request: GitSshRequest) => gitSshRequest(request, {
    home: os.homedir(),
    agents: agentsHere(),
    appKnownHostsFile: path.join(app.getPath('userData'), 'ssh', 'known_hosts'),
    askToTrust: host => askToTrust(BrowserWindow.fromWebContents(event.sender), host),
  }));
}
