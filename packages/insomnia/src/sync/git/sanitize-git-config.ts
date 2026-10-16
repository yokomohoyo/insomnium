// Before GIT_INTERNAL_DIR was absolute, a pulled repository file git/config
// replaced the real one, so it could carry a pushurl or http.corsProxy that
// sends pushes, fetches and credentials elsewhere. Rather than unset keys
// (isomorphic-git's parser lets a crafted section header pass for a key, and
// removing it re-parents the lines below), keep only what Insomnium and
// isomorphic-git write and drop every other section whole.

const HEADER = /^\s*\[\s*([A-Za-z][A-Za-z0-9-]*)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]\s*(?:[#;].*)?$/;
const ENTRY = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*(?:=.*)?$/;
const BLANK_OR_COMMENT = /^\s*(?:[#;].*)?$/;

const allowedKeys = (section: string, subsection: string | null) => {
  if (section === 'core' && subsection === null) {
    return ['repositoryformatversion', 'filemode', 'bare', 'logallrefupdates', 'symlinks', 'ignorecase'];
  }
  if (section === 'remote' && subsection === 'origin') {
    return ['url', 'fetch'];
  }
  if (section === 'user' && subsection === null) {
    return ['name', 'email'];
  }
  if (section === 'branch' && subsection !== null) {
    return ['remote', 'merge'];
  }
  return null;
};

export function sanitizeGitConfig(text: string) {
  const kept: string[] = [];
  let keys: string[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    const header = HEADER.exec(line);
    if (header) {
      keys = allowedKeys(header[1].toLowerCase(), header[2] ?? null);
      if (keys) {
        kept.push(line);
      }
    } else if (BLANK_OR_COMMENT.test(line)) {
      if (keys) {
        kept.push(line);
      }
    } else {
      const entry = ENTRY.exec(line);
      // a trailing backslash would continue the value onto the next line
      if (keys && entry && keys.includes(entry[1].toLowerCase()) && !line.trimEnd().endsWith('\\')) {
        kept.push(line);
      }
    }
  }
  return kept.join('\n');
}
