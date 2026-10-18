// The requests open as tabs in a workspace, in order (WorkspaceMeta, so they
// stay on this computer): opening one adds it at the end, and the oldest go
// when there are too many.
export const MAX_OPEN_TABS = 30;

export const withTab = (open: string[], id: string, max = MAX_OPEN_TABS) =>
  open.includes(id) ? open : [...open, id].slice(-max);

export const withoutTab = (open: string[], id: string) => open.filter(other => other !== id);

// the tab to show when this one closes: the next, or else the one before
export const neighborOf = (open: string[], id: string) => {
  const index = open.indexOf(id);
  if (index === -1) {
    return undefined;
  }
  return open[index + 1] ?? open[index - 1];
};
