import crypto from 'crypto';

import { t } from '../common/i18n';

// Unit tests run as JavaScript with Node, with all the access the app has. A
// test written or saved here is trusted; one that came from an import, a Git
// pull or a sync is asked about before it first runs (the MCP server asks for
// every run). Trust is by the code's hash, on this computer.
const KEY = 'insomnium.trustedTestCode';
const MAX = 2000;

const hashOf = (code: string) => crypto.createHash('sha256').update(code).digest('hex');

const trusted = (): string[] => {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

export function trustTestCode(codes: string[]) {
  const hashes = [...new Set([...trusted(), ...codes.map(hashOf)])].slice(-MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(hashes));
  } catch {
    // not kept: they'll be asked about again
  }
}

// whether to run these tests: yes for trusted code, else as the user says
export function mayRunTests(tests: { name: string; code: string }[]) {
  const known = new Set(trusted());
  const unknown = tests.filter(test => !known.has(hashOf(test.code)));
  if (!unknown.length) {
    return true;
  }
  const names = unknown.map(test => `- ${test.name}`).join('\n');
  const yes = window.confirm(t("These tests weren't written in this app, and run as JavaScript with full access to your computer:\n\n{names}\n\nRun them only if you trust where they came from.", { names }));
  if (yes) {
    trustTestCode(unknown.map(test => test.code));
  }
  return yes;
}
