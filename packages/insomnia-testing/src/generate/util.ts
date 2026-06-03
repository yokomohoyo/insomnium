export const escapeJsStr = (s: string) => {
  // Escape backslash first so we don't double-escape introduced backslashes.
  return s.replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
};

export const indent = (level: number, code: string) => {
  if (!level || level < 0) {
    return code;
  }

  const prefix = new Array(level + 1).join('  ');
  return code
    .split('\n')
    .map(line => prefix + line)
    .join('\n');
};
