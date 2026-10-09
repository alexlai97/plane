export type PeekLocation = { workspaceSlug: string; projectId: string; issueId: string };

const same = (a: PeekLocation, b: PeekLocation) => a.issueId === b.issueId && a.projectId === b.projectId;

/** Keep a bounded trail within the current peek session; revisiting an ancestor unwinds it. */
export function nextPeekTrail<T extends PeekLocation>(trail: T[], current: T | undefined, next: T | undefined): T[] {
  if (!current || !next || current.workspaceSlug !== next.workspaceSlug) return [];
  if (same(current, next)) return trail;
  const previous = trail.findIndex((item) => same(item, next));
  return previous >= 0 ? trail.slice(0, previous) : [...trail, current].slice(-30);
}
