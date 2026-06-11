interface ParentNode {
  _id: string;
  parentId: string | null;
}

// Cycle-safe walk up parentId links; true if the chain reaches ancestorId.
export function isDescendantOf(parentId: string | null | undefined, ancestorId: string, nodes: ParentNode[]): boolean {
  let cur: string | null | undefined = parentId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    const next = nodes.find(n => n._id === cur);
    cur = next ? next.parentId : null;
  }
  return false;
}
