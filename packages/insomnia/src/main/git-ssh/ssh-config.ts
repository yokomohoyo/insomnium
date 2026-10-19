// What ~/.ssh/config says for a host, as ssh reads it: the Host blocks that
// match it (and the lines before any Host), the first value of each setting
// winning. Only the settings Git over SSH uses are read; Match blocks and
// Include aren't followed.

export interface HostConfig {
  hostName?: string;
  user?: string;
  port?: number;
  identityFiles: string[];
}

// a Host pattern: * and ? as in a shell
const matches = (pattern: string, host: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i').test(host);

// Host a b !c: one of the patterns, and none of the negated ones
export const hostMatches = (patterns: string[], host: string) =>
  patterns.some(pattern => !pattern.startsWith('!') && matches(pattern, host))
  && !patterns.some(pattern => pattern.startsWith('!') && matches(pattern.slice(1), host));

const unquote = (value: string) => value.replace(/^"(.*)"$/, '$1');

export function hostConfig(text: string, host: string, home: string): HostConfig {
  const config: HostConfig = { identityFiles: [] };
  let applies = true;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = line.match(/^(\S+?)\s*(?:=\s*|\s+)(.*)$/);
    if (!match) {
      continue;
    }
    const keyword = match[1].toLowerCase();
    const value = match[2].trim();
    if (keyword === 'host') {
      applies = hostMatches(value.split(/\s+/).map(unquote), host);
      continue;
    }
    if (keyword === 'match') {
      // not followed: its settings are left out
      applies = false;
      continue;
    }
    if (!applies) {
      continue;
    }
    const setting = unquote(value);
    if (keyword === 'hostname' && config.hostName === undefined) {
      config.hostName = setting.replace(/%h/g, host);
    } else if (keyword === 'user' && config.user === undefined) {
      config.user = setting;
    } else if (keyword === 'port' && config.port === undefined && /^\d+$/.test(setting)) {
      config.port = Number(setting);
    } else if (keyword === 'identityfile') {
      config.identityFiles.push(setting.replace(/^~(?=$|[\\/])/, home).replace(/%d/g, home).replace(/%h/g, config.hostName || host));
    }
  }
  return config;
}
