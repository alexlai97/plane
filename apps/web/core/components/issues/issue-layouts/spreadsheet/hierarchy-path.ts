export type HierarchyParent = { id: string; name: string; parent_id: string | null; sequence_id: number };

/** Context only: excluded ancestors never become report results. */
export async function loadHierarchyPath(
  parentId: string,
  retrieve: (id: string) => Promise<HierarchyParent>
): Promise<HierarchyParent[]> {
  const path: HierarchyParent[] = [];
  const visited = new Set<string>();
  let id: string | null = parentId;
  while (id && !visited.has(id)) {
    visited.add(id);
    // Each next ancestor depends on the previous response.
    // oxlint-disable-next-line no-await-in-loop
    const parent = await retrieve(id);
    path.unshift(parent);
    id = parent.parent_id;
  }
  return path;
}
