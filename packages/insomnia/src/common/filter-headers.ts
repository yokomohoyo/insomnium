export function filterHeaders<T extends { name: string; value: string }>(headers: T[], name?: string): T[] {
  if (!Array.isArray(headers) || !name || typeof name !== 'string') {
    return [];
  }

  return headers.filter(header => {
    // Never match against invalid headers
    if (!header || !header.name || typeof header.name !== 'string') {
      return false;
    }

    return header.name.toLowerCase() === name.toLowerCase();
  });
}
