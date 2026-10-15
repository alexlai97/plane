/** A materialized issue result can be ungrouped, grouped, or subgrouped. */
export type GroupedIssueMembership = readonly string[] | { readonly [key: string]: GroupedIssueMembership | undefined };

export function hasGroupedIssue(results: GroupedIssueMembership | undefined, issueId: string): boolean {
  if (!results) return false;
  if (Array.isArray(results)) return results.includes(issueId);
  return Object.values(results).some((group) => hasGroupedIssue(group, issueId));
}

export function getIssueMembershipGroups(
  results: { readonly [key: string]: GroupedIssueMembership | undefined } | undefined,
  issueId: string
): Set<string> {
  return new Set(
    Object.entries(results ?? {})
      .filter(([, group]) => hasGroupedIssue(group, issueId))
      .map(([id]) => id)
  );
}
