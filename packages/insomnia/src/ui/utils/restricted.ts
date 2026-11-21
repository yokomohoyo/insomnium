// Which of a collection's requests and folders are marked as for some users
// only (securityRestricted): those marked themselves, and everything in a
// marked folder. The sidebar shows a lock on them, and the security checks
// try them with less privilege.
interface Item {
  doc: { _id: string; securityRestricted?: boolean };
  // the ids of the folders it's in
  ancestors?: string[];
}

export const restrictedIds = (collection: Item[]) => {
  const marked = new Set(collection.filter(({ doc }) => doc.securityRestricted).map(({ doc }) => doc._id));
  return new Set(collection
    .filter(({ doc, ancestors }) => marked.has(doc._id) || ancestors?.some(id => marked.has(id)))
    .map(({ doc }) => doc._id));
};
