import type { WorkspaceAccessPolicy } from "@/services/access-policy.service";

const workspacePolicies = new Map<string, WorkspaceAccessPolicy>();

export function cacheWorkspaceAccessPolicy(workspaceSlug: string, policy: WorkspaceAccessPolicy) {
  workspacePolicies.set(workspaceSlug, policy);
}

export function clearWorkspaceAccessPolicy(workspaceSlug: string) {
  workspacePolicies.delete(workspaceSlug);
}

export function canReadWorkItemDetails(workspaceSlug: string) {
  return workspacePolicies.get(workspaceSlug)?.capabilities?.includes("work_item.detail.read") ?? false;
}

export function isSummaryObserverProfile(workspaceSlug: string) {
  return workspacePolicies.get(workspaceSlug)?.profile === "summary_observer";
}
